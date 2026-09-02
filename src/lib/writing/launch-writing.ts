import { existsSync, readFileSync } from "node:fs";
import { getContentItem } from "@/lib/db/queries/content";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  type LaunchWritingDocument,
  launchWritingPatchSchema,
  launchWritingSchema,
  sourceRefSchema,
  userApprovalSchema,
} from "@/lib/writing/contracts";
import { computeSpineHash, sha256 } from "@/lib/writing/hash";
import { db } from "@/lib/db/client";
import { launchCompositionSchema, type LaunchComposition } from "@/lib/writing/contracts";
import { resolveComposedRunAuthorityByToken } from "@/lib/writing/writing-intent-authority";

/**
 * Resolve a presented capability, or refuse the whole call.
 *
 * Presenting a token is an explicit composed-lane attempt, so a malformed, unknown, or mismatched
 * one is an error rather than a silent downgrade to ordinary writing — otherwise a real dispatch
 * whose capability failed to verify would quietly get an unscoped launch and only discover the
 * problem when its first proposal is rejected. Omitting the token remains ordinary writing.
 */
function resolvePresentedWritingScope(token: string | undefined) {
  if (token === undefined) return null;
  const authority = resolveComposedRunAuthorityByToken(db, token);
  if (!authority) {
    throw new AgentToolError("VALIDATION_ERROR", "Writing scope token is invalid or unknown", {
      reason: "writing_scope_token_invalid",
      path: ["writingScopeToken"],
    });
  }
  return authority;
}

/**
 * Stamp the server-owned composition scope onto a launch.
 *
 * Minted only from a dispatch-issued capability token. Naming a composed run in caller-owned
 * `writing.runs` deliberately does **not** mint a scope: a run id is a selector the caller can
 * choose, so honouring it would let any launch claim any composed dispatch. Immutable once stamped,
 * so a later `upsert_launch` can neither shed the mandate nor repoint the association.
 */
function stampLaunchComposition(input: {
  stored: Record<string, unknown>;
  authority: ReturnType<typeof resolvePresentedWritingScope>;
}): LaunchComposition | null {
  const existing = launchCompositionSchema.safeParse(parseObject(input.stored).composition);
  if (existing.success) return existing.data;
  if (!input.authority) return null;
  const { workflowRunId, templateId, composition } = input.authority;
  return launchCompositionSchema.parse({
    schemaVersion: 1,
    workflowRunId,
    templateId,
    consumer: composition.consumer,
    mandate: composition.mandate,
    surfaces: composition.surfaces,
    stampedAt: Math.floor(Date.now() / 1000),
  });
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return parseObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (
    base && patch &&
    typeof base === "object" && !Array.isArray(base) &&
    typeof patch === "object" && !Array.isArray(patch)
  ) {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      result[key] = deepMerge(result[key], value);
    }
    return result;
  }
  return patch;
}

function validation(message: string, reason: string, details?: unknown): never {
  throw new AgentToolError("VALIDATION_ERROR", message, { reason, ...(details ? { details } : {}) });
}

function normalizeApproval(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  field: "contextApproval" | "outputApproval",
): Record<string, unknown> {
  const hasIncoming = Object.prototype.hasOwnProperty.call(incoming, field);
  const candidate = hasIncoming ? incoming[field] : stored?.[field];
  const parsed = userApprovalSchema.safeParse(candidate);
  const result = { ...incoming };
  delete result[field];
  if (parsed.success) result[field] = parsed.data;
  return result;
}

function normalizeSource(
  sourceValue: unknown,
  storedValue: unknown,
  scope: "shared" | "local_only",
) {
  let source = parseObject(sourceValue);
  const stored = parseObject(storedValue);
  source = normalizeApproval(source, stored, "contextApproval");
  const sensitivity = normalizeApproval(
    parseObject(source.sensitivity),
    parseObject(stored.sensitivity),
    "contextApproval",
  );
  let bodyHash: string | undefined;
  let forcedReason: string | undefined;
  if (source.kind === "content_item" && typeof source.contentItemId === "string") {
    const item = getContentItem(source.contentItemId);
    if (!item) throw new AgentToolError("NOT_FOUND", `Content item not found: ${source.contentItemId}`);
    source = { ...source, contentType: item.contentType, direction: item.direction };
    bodyHash = sha256(item.body ?? "");
    if (item.contentType === "email" || item.contentType === "dm") forcedReason = "private_content_type";
    else if (item.direction === "inbound") forcedReason = "inbound";
  } else if (source.kind === "url") {
    bodyHash = sha256(typeof source.excerpt === "string" ? source.excerpt : "");
  } else if (source.kind === "note") {
    bodyHash = sha256(typeof source.text === "string" ? source.text : "");
  } else if (source.kind === "file" && typeof source.path === "string") {
    if (!existsSync(source.path)) validation("Source file cannot be read", "source_file_not_found", { path: source.path });
    bodyHash = sha256(readFileSync(source.path));
  }
  if (scope === "local_only") forcedReason = "launch_local_only";
  const currentLevel = sensitivity.level === "private" ? "private" : "public";
  source = {
    ...source,
    ...(bodyHash ? { sha256: bodyHash } : {}),
    sensitivity: {
      ...sensitivity,
      level: forcedReason ? "private" : currentLevel,
      reason: forcedReason ?? (currentLevel === "private" ? "user_marked" : "public_default"),
    },
  };
  const parsed = sourceRefSchema.safeParse(source);
  if (!parsed.success) throw new AgentToolError("VALIDATION_ERROR", "Invalid launch source", parsed.error.flatten());
  return parsed.data;
}

function mergeById(
  incoming: unknown[],
  stored: unknown[],
  normalize: (value: unknown, prior: unknown) => unknown,
): unknown[] {
  const storedById = new Map(stored.map((entry) => [parseObject(entry).id, entry]));
  return incoming.map((entry) => normalize(entry, storedById.get(parseObject(entry).id)));
}

function stripMalformedApprovals(value: Record<string, unknown>): Record<string, unknown> {
  const writing = structuredClone(value);
  const sanitizeSources = (sources: unknown) => {
    if (!Array.isArray(sources)) return;
    for (const raw of sources) {
      const source = parseObject(raw);
      const sensitivity = parseObject(source.sensitivity);
      if (Object.prototype.hasOwnProperty.call(sensitivity, "contextApproval") && !userApprovalSchema.safeParse(sensitivity.contextApproval).success) {
        delete sensitivity.contextApproval;
        source.sensitivity = sensitivity;
      }
    }
  };
  sanitizeSources(writing.sources);
  const spine = parseObject(writing.spine);
  sanitizeSources(spine.sources);
  if (Array.isArray(spine.claims)) {
    for (const raw of spine.claims) {
      const claim = parseObject(raw);
      if (Object.prototype.hasOwnProperty.call(claim, "outputApproval") && !userApprovalSchema.safeParse(claim.outputApproval).success) delete claim.outputApproval;
    }
  }
  if (writing.spine) writing.spine = spine;
  return writing;
}

export function readLaunchWriting(metadata: unknown): LaunchWritingDocument | null {
  const parsed = launchWritingSchema.safeParse(parseObject(metadata).writing);
  return parsed.success ? parsed.data : null;
}

export function mergeLaunchMetadata(input: {
  existingMetadata: unknown;
  incomingMetadata: Record<string, unknown> | undefined;
  launchId: string;
  scope: "shared" | "local_only";
  /** Dispatch-issued capability; the only way a launch becomes a composed scope. */
  writingScopeToken?: string;
}): { metadata: Record<string, unknown>; writing: LaunchWritingDocument | null; spineChanged: boolean } {
  // Before any early return: a presented capability is validated whatever the metadata shape is.
  const presentedScope = resolvePresentedWritingScope(input.writingScopeToken);
  const existingRoot = parseObject(input.existingMetadata);
  if (!input.incomingMetadata) {
    return { metadata: existingRoot, writing: readLaunchWriting(existingRoot), spineChanged: false };
  }
  const incomingRoot = { ...input.incomingMetadata };
  if (!Object.prototype.hasOwnProperty.call(incomingRoot, "writing")) {
    return { metadata: { ...existingRoot, ...incomingRoot, ...(existingRoot.writing ? { writing: existingRoot.writing } : {}) }, writing: readLaunchWriting(existingRoot), spineChanged: false };
  }
  const rawWriting = parseObject(incomingRoot.writing);
  const storedWriting = parseObject(existingRoot.writing);
  if (rawWriting.schemaVersion !== 1 && storedWriting.schemaVersion !== 1) {
    const legacy = { ...storedWriting, ...rawWriting };
    const storedSources = new Map(
      (Array.isArray(storedWriting.sources) ? storedWriting.sources : []).map((source) => [parseObject(source).id, parseObject(source)]),
    );
    if (Array.isArray(rawWriting.sources)) {
      legacy.sources = rawWriting.sources.map((value) => {
        const source = parseObject(value);
        const prior = storedSources.get(source.id);
        const sensitivity = normalizeApproval(parseObject(source.sensitivity), parseObject(prior?.sensitivity), "contextApproval");
        let reason = sensitivity.level === "private" ? "user_marked" : "public_default";
        let level = sensitivity.level === "private" ? "private" : "public";
        const normalized = { ...source };
        if (source.kind === "content_item" && typeof source.contentItemId === "string") {
          const item = getContentItem(source.contentItemId);
          if (item) {
            normalized.contentType = item.contentType;
            normalized.direction = item.direction;
            normalized.sha256 = sha256(item.body ?? "");
            if (item.contentType === "email" || item.contentType === "dm") { level = "private"; reason = "private_content_type"; }
            else if (item.direction === "inbound") { level = "private"; reason = "inbound"; }
          }
        }
        if (input.scope === "local_only") { level = "private"; reason = "launch_local_only"; }
        normalized.sensitivity = { ...sensitivity, level, reason };
        return normalized;
      });
    }
    const metadata = { ...existingRoot, ...incomingRoot, writing: legacy };
    return { metadata, writing: null, spineChanged: false };
  }
  const sanitizedWriting = stripMalformedApprovals(rawWriting);
  const patch = launchWritingPatchSchema.safeParse(sanitizedWriting);
  if (!patch.success) throw new AgentToolError("VALIDATION_ERROR", "Invalid launch writing metadata", patch.error.flatten());
  const stored = storedWriting;
  const merged: Record<string, unknown> = {
    ...(deepMerge(stored, patch.data) as Record<string, unknown>),
    schemaVersion: 1,
  };
  const incomingSources = Array.isArray(patch.data.sources) ? patch.data.sources : undefined;
  const storedSources = Array.isArray(stored.sources) ? stored.sources : [];
  if (incomingSources) {
    merged.sources = mergeById(incomingSources, storedSources, (value, prior) => normalizeSource(value, prior, input.scope));
  } else if (storedSources.length) {
    merged.sources = storedSources.map((value) => normalizeSource(value, value, input.scope));
  }
  if (patch.data.spine) {
    const storedSpine = parseObject(stored.spine);
    const incomingSpine: Record<string, unknown> = {
      ...(deepMerge(storedSpine, patch.data.spine) as Record<string, unknown>),
      launchId: input.launchId,
    };
    const sources = mergeById(
      Array.isArray(incomingSpine.sources) ? incomingSpine.sources : [],
      Array.isArray(storedSpine.sources) ? storedSpine.sources : [],
      (value, prior) => normalizeSource(value, prior, input.scope),
    );
    const storedClaims = new Map((Array.isArray(storedSpine.claims) ? storedSpine.claims : []).map((claim) => [parseObject(claim).id, parseObject(claim)]));
    const claims = (Array.isArray(incomingSpine.claims) ? incomingSpine.claims : []).map((claimValue: unknown) => {
      const claim = parseObject(claimValue);
      return normalizeApproval(claim, storedClaims.get(claim.id), "outputApproval");
    });
    const candidate: Record<string, unknown> = { ...incomingSpine, sources, claims };
    candidate.hash = computeSpineHash(candidate);
    merged.spine = candidate;
  } else if (stored.spine) {
    const spine = parseObject(stored.spine);
    const sources = (Array.isArray(spine.sources) ? spine.sources : []).map((value) => normalizeSource(value, value, input.scope));
    merged.spine = { ...spine, sources, hash: computeSpineHash({ ...spine, sources }) };
  }
  // Composition is server-owned: drop whatever the caller sent and re-derive it.
  delete merged.composition;
  const composition = stampLaunchComposition({ stored, authority: presentedScope });
  if (composition) merged.composition = composition;
  const parsed = launchWritingSchema.safeParse(merged);
  if (!parsed.success) throw new AgentToolError("VALIDATION_ERROR", "Incomplete launch writing metadata", parsed.error.flatten());
  if (parsed.data.spine && parsed.data.spine.launchId !== input.launchId) validation("Spine launch does not match launch", "spine_launch_mismatch");
  for (const surface of parsed.data.surfaces ?? []) {
    if (!surface.surface.startsWith(`${surface.platform}/`)) validation("Surface does not match platform", "surface_platform_mismatch", surface);
  }
  const oldHash = readLaunchWriting(existingRoot)?.spine?.hash;
  const newHash = parsed.data.spine?.hash;
  return {
    metadata: { ...existingRoot, ...incomingRoot, writing: parsed.data },
    writing: parsed.data,
    spineChanged: Boolean(oldHash && newHash && oldHash !== newHash),
  };
}
