import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { userApprovalSchema } from "@/lib/writing/contracts";
import { AgentToolError } from "@/lib/agent-tools/types";
import { db } from "@/lib/db/client";
import { PLATFORMS, type Platform } from "@/lib/db/platforms";
import {
  contentItems,
  mediaAttachments,
} from "@/lib/db/schema";
import {
  findContentItemByWritingIdempotencyKey,
  getContentItem,
  getContentItemDetail,
} from "@/lib/db/queries/content";
import { getContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { getLaunchById } from "@/lib/db/queries/launches";
import { getMediaAsset, linkMediaToContent } from "@/lib/db/queries/media";
import { getNicheById } from "@/lib/db/queries/niches";
import {
  listPlatformTargets,
  resolveTargetById,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";
import { getVariantById, listVariantsByLaunchId } from "@/lib/db/queries/variants";
import { EDITABLE_STATUSES } from "@/lib/publish/save-compose-draft";
import { getWritingApprovalPolicy } from "@/lib/settings/writing-approval-policy";
import {
  getSurfaceCapabilities,
  publishCapabilityForPlatform,
} from "@/lib/writing/capabilities";
import {
  buildWritingUnits,
  mergeContentWriting,
  readContentWriting,
} from "@/lib/writing/content-writing";
import { parseSurfaceId, surfaceForDraft, SURFACE_IDS } from "@/lib/writing/surfaces";
import { readVariantWritingProjection } from "@/lib/writing/variant-writing-projection";
import { computeAuditInputHash } from "@/lib/writing/hash";
import { getVoiceProfile, resolveActiveVoiceProfileContext } from "@/lib/writing/voice-profile-store";
import { getNeighbors } from "@/lib/db/queries/graph";

const MAX_BODY_LENGTH = 65_536;
const MAX_THREAD_TEXTS = 24;
const MAX_THREAD_TEXT_LENGTH = 4_000;
const MAX_MEDIA_ASSETS = 10;

const originSchema = z.object({
  launchId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
});

export const getContentSchema = z.object({
  contentItemId: z.string().min(1),
  includeMetrics: z.boolean().optional().default(false),
  writingSource: z
    .object({ launchId: z.string().min(1), sourceId: z.string().min(1) })
    .optional(),
});

export const createContentDraftSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  platform: z.enum(PLATFORMS),
  contentType: z.enum(["post", "thread"]),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
  title: z.string().max(300).optional(),
  threadTexts: z
    .array(
      z
        .string()
        .min(1)
        .max(MAX_THREAD_TEXT_LENGTH)
        .describe("Ordered continuation unit; allowed only for thread drafts."),
    )
    .max(MAX_THREAD_TEXTS)
    .optional()
    .describe("Required and non-empty for threads; forbidden for posts."),
  mediaAssetIds: z.array(z.string().min(1)).max(MAX_MEDIA_ASSETS).optional(),
  targetId: z
    .string()
    .min(1)
    .optional()
    .describe("When present, the target must be active and match platform."),
  origin: originSchema.optional(),
});

export const updateContentDraftSchema = z.object({
  contentItemId: z.string().min(1),
  body: z.string().min(1).max(MAX_BODY_LENGTH).optional(),
  title: z.string().max(300).optional(),
  threadTexts: z
    .array(z.string().min(1).max(MAX_THREAD_TEXT_LENGTH))
    .max(MAX_THREAD_TEXTS)
    .optional()
    .describe("Only valid for a thread; replaces all continuation units."),
  mediaAssetIds: z.array(z.string().min(1)).max(MAX_MEDIA_ASSETS).optional(),
  expectedUpdatedAt: z.number().int().nonnegative().optional(),
});

export const getWritingContextSchema = z.object({
  launchId: z.string().min(1),
  surfaces: z.array(z.enum(SURFACE_IDS)).optional(),
  includeSources: z.boolean().optional().default(true),
});

type SensitivityReason =
  | "public_default"
  | "private_content_type"
  | "inbound"
  | "user_marked"
  | "launch_local_only";

type Sensitivity = {
  level: "public" | "private";
  reason: SensitivityReason;
  contextApproval?: true;
};

function hasDurableContextApproval(value: unknown): boolean {
  return userApprovalSchema.safeParse(value).success;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function baseSensitivity(item: {
  contentType: string;
  direction: string | null;
}): Sensitivity {
  if (item.contentType === "email" || item.contentType === "dm") {
    return { level: "private", reason: "private_content_type" };
  }
  if (item.direction === "inbound") return { level: "private", reason: "inbound" };
  return { level: "public", reason: "public_default" };
}

function launchWriting(launch: { metadata: string | null }): Record<string, unknown> | null {
  const value = parseObject(launch.metadata).writing;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasStoredContentApproval(input: {
  launchId: string;
  sourceId: string;
  contentItemId: string;
}): boolean {
  const launch = getLaunchById(input.launchId);
  const writing = launch ? launchWriting(launch) : null;
  if (!writing) return false;
  return parseArray(writing.sources).some((source) => {
    const sensitivity = parseObject(source.sensitivity);
    return (
      source.id === input.sourceId &&
      source.kind === "content_item" &&
      source.contentItemId === input.contentItemId &&
      hasDurableContextApproval(sensitivity.contextApproval)
    );
  });
}

function normalizedNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AgentToolError("VALIDATION_ERROR", `${field} must not be blank`);
  return normalized;
}

function normalizedThreadTexts(values: string[] | undefined): string[] | undefined {
  return values?.map((value, index) => normalizedNonBlank(value, `threadTexts[${index}]`));
}

export async function handleGetContent(input: z.infer<typeof getContentSchema>) {
  const detail = getContentItemDetail(input.contentItemId);
  if (!detail) {
    throw new AgentToolError("NOT_FOUND", `Content item not found: ${input.contentItemId}`);
  }

  const { item } = detail;
  const sensitivity = baseSensitivity(item);
  const approved =
    sensitivity.level === "private" && input.writingSource
      ? hasStoredContentApproval({
          ...input.writingSource,
          contentItemId: input.contentItemId,
        })
      : false;
  const redacted = sensitivity.level === "private" && !approved;
  const writing = readContentWriting(item);
  const platformData = parseObject(item.platformData);

  return {
    contentItem: {
      id: item.id,
      title: redacted ? null : item.title,
      contentType: item.contentType,
      platformTarget: item.platformTarget,
      status: item.status,
      origin: item.origin,
      direction: item.direction,
      aiGenerated: item.aiGenerated,
      threadId: item.threadId,
      parentItemId: item.parentItemId,
      contactId: item.contactId,
      platformAccountId: item.platformAccountId,
      scheduledAt: item.scheduledAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sensitivity,
      body: redacted ? null : item.body,
      ...(redacted
        ? {
            redacted: true as const,
            redactionReason: "context_approval_required" as const,
          }
        : {}),
      // Writing units contain the canonical body, so retaining them would bypass body redaction.
      platformData: redacted ? {} : platformData,
      writing: redacted ? null : writing,
    },
    media: redacted ? [] : detail.media,
    post: detail.post,
    ...(input.includeMetrics ? { latestMetrics: detail.latestMetrics } : {}),
    gtm: redacted ? null : getContentGtmContext(item.id),
  };
}

function validateCreateReferences(input: z.infer<typeof createContentDraftSchema>): void {
  if (input.targetId) {
    const target = resolveTargetById(input.targetId);
    if (!target) throw new AgentToolError("NOT_FOUND", `Platform target not found: ${input.targetId}`);
    if (target.status !== "active" || target.platform !== input.platform) {
      throw new AgentToolError("VALIDATION_ERROR", "Target must be active and match platform", {
        targetId: input.targetId,
        expectedPlatform: input.platform,
        actualPlatform: target.platform,
        status: target.status,
      });
    }
  }
  if (input.origin?.launchId && !getLaunchById(input.origin.launchId)) {
    throw new AgentToolError("NOT_FOUND", `Launch not found: ${input.origin.launchId}`);
  }
  if (input.origin?.variantId && !getVariantById(input.origin.variantId)) {
    throw new AgentToolError("NOT_FOUND", `Variant not found: ${input.origin.variantId}`);
  }
  for (const assetId of input.mediaAssetIds ?? []) {
    if (!getMediaAsset(assetId)) {
      throw new AgentToolError("NOT_FOUND", `Media asset not found: ${assetId}`);
    }
  }
}

export async function handleCreateContentDraft(
  input: z.infer<typeof createContentDraftSchema>,
) {
  const idempotencyKey = normalizedNonBlank(input.idempotencyKey, "idempotencyKey");
  const body = normalizedNonBlank(input.body, "body");
  const threadTexts = normalizedThreadTexts(input.threadTexts);
  if (input.contentType === "thread") {
    if (!threadTexts?.length) {
      throw new AgentToolError("VALIDATION_ERROR", "threadTexts is required for a thread");
    }
    if (!surfaceForDraft(input.platform, "thread")) {
      throw new AgentToolError("VALIDATION_ERROR", `Thread surface is unavailable for ${input.platform}`);
    }
  } else if (input.threadTexts !== undefined) {
    throw new AgentToolError("VALIDATION_ERROR", "threadTexts is forbidden for a post");
  }

  const result = db.transaction(() => {
    const replay = findContentItemByWritingIdempotencyKey(idempotencyKey);
    if (replay) {
      const existingWriting = readContentWriting(replay);
      return {
        contentItemId: replay.id,
        created: false,
        status: "draft" as const,
        surface: existingWriting?.surface ?? null,
        capability: existingWriting?.capability ?? {
          publish: publishCapabilityForPlatform(input.platform),
        },
      };
    }

    validateCreateReferences(input);
    const surface = surfaceForDraft(input.platform, input.contentType);
    const publish = surface
      ? getSurfaceCapabilities(surface).publish
      : publishCapabilityForPlatform(input.platform) === "unsupported"
        ? "unsupported"
        : "draft_only";
    const texts = [body, ...(threadTexts ?? [])];
    const writing = {
      schemaVersion: 1 as const,
      idempotencyKey,
      surface,
      capability: { publish },
      units: buildWritingUnits(texts),
      platform: input.platform,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.origin
        ? {
            origin: input.origin,
            ...(input.origin.launchId ? { launchId: input.origin.launchId } : {}),
            ...(input.origin.variantId ? { variantId: input.origin.variantId } : {}),
          }
        : {}),
    };
    const id = nanoid();
    db.insert(contentItems)
      .values({
        id,
        body,
        title: input.title?.trim() || body.slice(0, 80),
        contentType: input.contentType,
        platformTarget: input.platform,
        status: "draft",
        origin: "authored",
        direction: "outbound",
        aiGenerated: true,
        platformAccountId: null,
        platformData: mergeContentWriting({}, writing),
      })
      .run();
    for (const assetId of input.mediaAssetIds ?? []) {
      linkMediaToContent(assetId, id, "agent:create_content_draft");
    }
    return {
      contentItemId: id,
      created: true,
      status: "draft" as const,
      surface,
      capability: { publish },
    };
  });

  return result;
}

function validateUpdateMedia(mediaAssetIds: string[] | undefined): void {
  for (const assetId of mediaAssetIds ?? []) {
    if (!getMediaAsset(assetId)) {
      throw new AgentToolError("NOT_FOUND", `Media asset not found: ${assetId}`);
    }
  }
}

export async function handleUpdateContentDraft(
  input: z.infer<typeof updateContentDraftSchema>,
) {
  const hasEdit = ["body", "title", "threadTexts", "mediaAssetIds"].some((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );
  if (!hasEdit) throw new AgentToolError("VALIDATION_ERROR", "At least one editable field is required");

  return db.transaction(() => {
    const item = getContentItem(input.contentItemId);
    if (!item) throw new AgentToolError("NOT_FOUND", `Content item not found: ${input.contentItemId}`);
    const writing = readContentWriting(item);
    if (!writing) {
      throw new AgentToolError("VALIDATION_ERROR", "Only writing drafts can be edited by this tool", {
        reason: "not_a_writing_draft",
      });
    }
    if (!EDITABLE_STATUSES.has(item.status)) {
      throw new AgentToolError("CONFLICT", `Cannot edit content in "${item.status}" status`, {
        status: item.status,
      });
    }
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== item.updatedAt) {
      throw new AgentToolError("CONFLICT", "Content item changed since it was read", {
        currentUpdatedAt: item.updatedAt,
      });
    }
    if (input.threadTexts !== undefined && item.contentType !== "thread") {
      throw new AgentToolError("VALIDATION_ERROR", "threadTexts is only valid for a thread");
    }
    const continuations =
      input.threadTexts !== undefined
        ? normalizedThreadTexts(input.threadTexts)
        : writing.units.texts.slice(1);
    if (item.contentType === "thread" && !continuations?.length) {
      throw new AgentToolError("VALIDATION_ERROR", "A thread requires at least one continuation unit");
    }
    validateUpdateMedia(input.mediaAssetIds);

    const body =
      input.body !== undefined
        ? normalizedNonBlank(input.body, "body")
        : writing.units.texts[0];
    const units = buildWritingUnits([body, ...(continuations ?? [])]);
    const updatedAt = Math.max(Math.floor(Date.now() / 1000), item.updatedAt + 1);
    db.update(contentItems)
      .set({
        body,
        ...(input.title !== undefined ? { title: input.title.trim() || null } : {}),
        platformData: mergeContentWriting(item.platformData, { units }),
        updatedAt,
      })
      .where(eq(contentItems.id, item.id))
      .run();

    if (input.mediaAssetIds !== undefined) {
      db.delete(mediaAttachments)
        .where(
          and(
            eq(mediaAttachments.parentType, "content_item"),
            eq(mediaAttachments.parentId, item.id),
            eq(mediaAttachments.role, "attachment"),
          ),
        )
        .run();
      for (const assetId of input.mediaAssetIds) {
        linkMediaToContent(assetId, item.id, "agent:update_content_draft");
      }
    }

    return {
      contentItemId: item.id,
      status: item.status,
      updatedAt,
      units: { count: units.count, chars: units.chars },
      capability: writing.capability,
    };
  });
}

function effectiveSourceSensitivity(input: {
  stored: Record<string, unknown>;
  launchScope: string;
  content?: { contentType: string; direction: string | null };
}): Sensitivity {
  const stored = parseObject(input.stored.sensitivity);
  const contextApproval = hasDurableContextApproval(stored.contextApproval);
  if (input.launchScope === "local_only") {
    return {
      level: "private",
      reason: "launch_local_only",
      ...(contextApproval ? { contextApproval: true as const } : {}),
    };
  }
  if (input.content) {
    const base = baseSensitivity(input.content);
    if (base.level === "private") {
      return { ...base, ...(contextApproval ? { contextApproval: true as const } : {}) };
    }
  }
  if (stored.level === "private") {
    return {
      level: "private",
      reason:
        stored.reason === "private_content_type" ||
        stored.reason === "inbound" ||
        stored.reason === "launch_local_only"
          ? stored.reason
          : "user_marked",
      ...(contextApproval ? { contextApproval: true as const } : {}),
    };
  }
  return { level: "public", reason: "public_default" };
}

function sourceView(source: Record<string, unknown>, launchScope: string) {
  const content =
    source.kind === "content_item" && typeof source.contentItemId === "string"
      ? getContentItem(source.contentItemId)
      : undefined;
  const sensitivity = effectiveSourceSensitivity({
    stored: source,
    launchScope,
    content: content
      ? { contentType: content.contentType, direction: content.direction }
      : undefined,
  });
  const approved = sensitivity.contextApproval === true;
  const redacted = sensitivity.level === "private" && !approved;
  const base = {
    ...(typeof source.id === "string" ? { id: source.id } : {}),
    ...(typeof source.kind === "string" ? { kind: source.kind } : {}),
    sensitivity,
  };

  if (source.kind === "content_item") {
    return {
      ...base,
      ...(typeof source.contentItemId === "string"
        ? { contentItemId: source.contentItemId }
        : {}),
      ...(typeof source.sha256 === "string" ? { sha256: source.sha256 } : {}),
      ...(typeof source.contentType === "string" ? { contentType: source.contentType } : {}),
      ...(source.direction === "inbound" || source.direction === "outbound" || source.direction === null
        ? { direction: source.direction }
        : {}),
      ...(redacted
        ? { redacted: true as const }
        : {
            ...(typeof source.title === "string" ? { title: source.title } : {}),
            body: content?.body ?? null,
          }),
    };
  }
  if (source.kind === "url") {
    return {
      ...base,
      ...(typeof source.url === "string" ? { url: source.url } : {}),
      ...(typeof source.retrievedAt === "number" ? { retrievedAt: source.retrievedAt } : {}),
      ...(typeof source.sha256 === "string" ? { sha256: source.sha256 } : {}),
      ...(redacted
        ? { redacted: true as const }
        : {
            ...(typeof source.title === "string" ? { title: source.title } : {}),
            ...(typeof source.excerpt === "string" ? { excerpt: source.excerpt } : {}),
          }),
    };
  }
  if (source.kind === "file") {
    return {
      ...base,
      ...(typeof source.path === "string" ? { path: source.path } : {}),
      ...(typeof source.sha256 === "string" ? { sha256: source.sha256 } : {}),
      ...(redacted ? { redacted: true as const } : {}),
    };
  }
  if (source.kind === "note") {
    return {
      ...base,
      ...(typeof source.enteredAt === "number" ? { enteredAt: source.enteredAt } : {}),
      ...(redacted
        ? { redacted: true as const }
        : typeof source.text === "string"
          ? { text: source.text }
          : {}),
    };
  }
  if (source.kind === "brief") {
    return {
      ...base,
      ...(typeof source.launchId === "string" ? { launchId: source.launchId } : {}),
      ...(redacted ? { redacted: true as const } : {}),
    };
  }
  return { ...base, ...(redacted ? { redacted: true as const } : {}) };
}

function projectLaunchWriting(
  writing: Record<string, unknown> | null,
  sourceViews: ReturnType<typeof sourceView>[],
  includeSources: boolean,
  launchScope: string,
): Record<string, unknown> | null {
  if (!writing) return null;
  const surfaces = parseArray(writing.surfaces).flatMap((entry) => {
    const surface = parseSurfaceId(entry.surface);
    if (!surface || typeof entry.platform !== "string") return [];
    return [
      {
        platform: entry.platform,
        surface,
        ...(typeof entry.targetId === "string" ? { targetId: entry.targetId } : {}),
      },
    ];
  });
  const runs = parseArray(writing.runs).flatMap((entry) => {
    if (typeof entry.workflowRunId !== "string" || typeof entry.startedAt !== "number") return [];
    return [
      {
        workflowRunId: entry.workflowRunId,
        ...(typeof entry.mode === "string" ? { mode: entry.mode } : {}),
        startedAt: entry.startedAt,
        ...(typeof entry.rtxThreadSlug === "string"
          ? { rtxThreadSlug: entry.rtxThreadSlug }
          : {}),
      },
    ];
  });
  return {
    ...(writing.schemaVersion === 1 ? { schemaVersion: 1 } : {}),
    ...(typeof writing.goal === "string" ? { goal: writing.goal } : {}),
    surfaces,
    ...(typeof writing.voicePrecedence === "string"
      ? { voicePrecedence: writing.voicePrecedence }
      : {}),
    ...(typeof writing.approvalPolicy === "string"
      ? { approvalPolicy: writing.approvalPolicy }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(writing, "voiceProfile")
      ? { voiceProfile: writing.voiceProfile }
      : {}),
    runs,
    ...(includeSources ? { sources: sourceViews } : {}),
    ...(projectSpine(writing.spine, includeSources, launchScope)
      ? { spine: projectSpine(writing.spine, includeSources, launchScope) }
      : {}),
  };
}

function projectSpine(
  value: unknown,
  includeSources: boolean,
  launchScope: string,
) {
  const spine = parseObject(value);
  if (!spine.id || !spine.hash) return null;
  const sourceViews = parseArray(spine.sources).map((source) => sourceView(source, launchScope));
  const redacted = new Set(
    sourceViews.filter((source) => "redacted" in source && source.redacted).map((source) => source.id),
  );
  const claims = parseArray(spine.claims).map((claim) => ({
    ...claim,
    ...(typeof claim.sourceId === "string" && redacted.has(claim.sourceId)
      ? { text: null, redacted: true }
      : {}),
  }));
  return {
    schemaVersion: spine.schemaVersion,
    id: spine.id,
    launchId: spine.launchId,
    goal: spine.goal,
    audience: spine.audience,
    ...(includeSources ? { sources: sourceViews } : {}),
    claims,
    message: spine.message,
    extractedBy: spine.extractedBy,
    hash: spine.hash,
  };
}

function resolveContextVoice(writing: Record<string, unknown> | null) {
  const pinned = parseObject(writing?.voiceProfile);
  if (typeof pinned.id === "string" && typeof pinned.version === "number") {
    try {
      const result = getVoiceProfile(pinned.id, pinned.version);
      return {
        profile: result.profile,
        status: result.profile.status === "superseded" ? "pinned_superseded" : "pinned",
        ...(result.active ? { activeVersion: result.active.version } : {}),
        candidates: [],
      };
    } catch {
      return { profile: null, status: "missing", candidates: [] };
    }
  }
  const active = resolveActiveVoiceProfileContext();
  return {
    profile: active.profile,
    status: active.profile ? (active.ambiguous ? "ambiguous" : "active") : "none",
    candidates: active.candidates,
  };
}

function requestedWritingSurfaces(
  inputSurfaces: z.infer<typeof getWritingContextSchema>["surfaces"],
  writing: Record<string, unknown> | null,
) {
  const stored = parseArray(writing?.surfaces)
    .map((entry) => parseSurfaceId(entry.surface))
    .filter((surface): surface is NonNullable<typeof surface> => Boolean(surface));
  return [...new Set([...(inputSurfaces ?? []), ...stored])];
}

export async function handleGetWritingContext(
  input: z.infer<typeof getWritingContextSchema>,
) {
  const launch = getLaunchById(input.launchId);
  if (!launch) throw new AgentToolError("NOT_FOUND", `Launch not found: ${input.launchId}`);
  const writing = launchWriting(launch);
  const sources = parseArray(writing?.sources);
  const surfaces = requestedWritingSurfaces(input.surfaces, writing);
  const audienceSpec = parseObject(launch.audienceSpec);
  const nicheIds = Array.isArray(audienceSpec.nicheIds)
    ? audienceSpec.nicheIds.filter((id): id is string => typeof id === "string")
    : [];
  const niches = nicheIds.flatMap((id) => {
    const niche = getNicheById(id);
    return niche
      ? [{ id: niche.id, name: niche.name, description: niche.description, scope: niche.scope }]
      : [];
  });
  const platforms = new Set(surfaces.map((surface) => surface.split("/")[0]));
  const targets = listPlatformTargets().flatMap((target) => {
    if (!platforms.has(target.platform)) return [];
    const view = toPlatformTargetView(target);
    return [
      {
        id: view.id,
        platform: view.platform,
        kind: view.kind,
        name: view.name,
        handle: view.handle,
        isDefault: view.isDefault,
        status: view.status,
        capabilities: view.capabilities,
      },
    ];
  });
  const capabilities = Object.fromEntries(
    surfaces.map((surface) => [surface, getSurfaceCapabilities(surface)]),
  );
  const variants = listVariantsByLaunchId(launch.id).map((variant) => {
    const projection = readVariantWritingProjection(variant);
    return {
      id: variant.id,
      label: variant.label,
      status: variant.status,
      ...(projection?.platform ? { platform: projection.platform } : {}),
      ...(projection?.surface ? { surface: projection.surface } : {}),
      ...(projection?.audit?.verdict ? { auditVerdict: projection.audit.verdict } : {}),
      ...(projection?.approval?.state ? { approvalState: projection.approval.state } : {}),
      ...(projection?.approval?.riskTier ? { riskTier: projection.approval.riskTier } : {}),
      auditStale: Boolean(
        projection?.audit &&
          projection.audit.inputHash !== computeAuditInputHash(variant.body, projection),
      ),
      materializedContentItemId: projection?.materializedContentItemId ?? variant.contentItemId,
      contentItemStatus: variant.contentItemId ? getContentItem(variant.contentItemId)?.status ?? null : null,
      lineage: projection?.lineage ?? null,
      updatedAt: variant.updatedAt,
    };
  });

  const briefRef = sources.find(
    (source) => source.kind === "brief" && source.launchId === launch.id,
  );
  const briefSensitivity: Sensitivity = briefRef
    ? effectiveSourceSensitivity({ stored: briefRef, launchScope: launch.scope })
    : launch.scope === "local_only"
      ? ({ level: "private", reason: "launch_local_only" } as const)
      : ({ level: "public", reason: "public_default" } as const);
  const briefApproved = briefSensitivity.contextApproval === true;
  const briefRedacted = briefSensitivity.level === "private" && !briefApproved;
  const sourceViews = sources.map((source) => sourceView(source, launch.scope));
  const writingView = projectLaunchWriting(writing, sourceViews, input.includeSources, launch.scope);
  const voice = resolveContextVoice(writing);

  return {
    launch: {
      id: launch.id,
      name: launch.name,
      status: launch.status,
      scope: launch.scope,
      primaryPlatform: launch.primaryPlatform,
      audienceSpec,
      brief: briefRedacted ? null : launch.brief,
      ...(briefRedacted ? { briefRedacted: true as const } : {}),
      writing: writingView,
    },
    niches,
    ...(input.includeSources
      ? { sources: sourceViews }
      : {}),
    targets,
    capabilities,
    variants,
    voiceProfile: voice.profile,
    voice: {
      status: voice.status,
      candidates: voice.candidates,
      ...("activeVersion" in voice && voice.activeVersion
        ? { activeVersion: voice.activeVersion }
        : {}),
    },
    approvalPolicy: typeof writing?.approvalPolicy === "string" ? writing.approvalPolicy : getWritingApprovalPolicy(),
  };
}
