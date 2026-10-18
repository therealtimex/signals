/**
 * Account objective (#549, spec §18): the operator's commercial intent for a composed run.
 *
 * The objective is captured at dispatch, normalized here, stamped onto the launch composition
 * scope, referenced by `{ objectiveId, hash }` from every writing intent, and validated on every
 * variant write — the same authority path the mandate already uses. The agent never authors it.
 *
 * Revision 2 input is an Objective brief: markdown written for the run or saved as
 * `objectives/<name>.md` in the Signals workspace, with `@` mentions of Personality files and
 * PRODUCTS.md entries. Normalization snapshots the brief and every mentioned excerpt, so the
 * stamped record is the run's authority even if those files change later
 * (see `objective-sources.ts`).
 */

import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  boundExcerpt,
  parseProductsCatalog,
  readWorkspaceResource,
  type ProductEntry,
  type WorkspaceResourceFile,
} from "@/lib/personality/workspace-resources";
import {
  parseObjectiveBriefPath,
  readSavedObjectiveBrief,
} from "@/lib/rtx/objective-brief-files";
import { canonicalJson, sha256, sha256Canonical } from "@/lib/writing/hash";
import { newWritingId } from "@/lib/writing/ids";
import {
  OBJECTIVE_BRIEF_MAX_CHARS,
  OBJECTIVE_MENTION_FILES,
  extractObjectiveMentions,
  parseObjectiveBrief,
  type ObjectiveBriefMentionToken,
} from "@/lib/writing/objective-brief";

/** Pinned by test; adding a kind needs an ADR (ADR-549-2). */
export const ACCOUNT_OBJECTIVE_KINDS = ["commercial", "relationship_only"] as const;
export type AccountObjectiveKind = (typeof ACCOUNT_OBJECTIVE_KINDS)[number];

export const ACCOUNT_OBJECTIVE_SCHEMA_VERSION = 2;
export const ACCOUNT_OBJECTIVE_CONFIG_KEY = "accountObjective";
/** Whole-record bound: brief (16 KiB) plus up to six 8 KiB excerpts and the parsed fields. */
export const ACCOUNT_OBJECTIVE_MAX_BYTES = 64 * 1024;

export const ACCOUNT_OBJECTIVE_SOURCES = ["run_config", "template_config", "default"] as const;
export type AccountObjectiveSource = (typeof ACCOUNT_OBJECTIVE_SOURCES)[number];

/** Server-computed, in this order; never changes approval policy, risk tier or audit verdict. */
export const ACCOUNT_OBJECTIVE_LIMITATIONS = [
  "offering_missing",
  "offering_unresolved",
  "offering_ambiguous",
  "offering_proof_missing",
  "mention_unresolved",
  "fit_missing",
  "success_missing",
] as const;
export type AccountObjectiveLimitation = (typeof ACCOUNT_OBJECTIVE_LIMITATIONS)[number];

export const OBJECTIVE_MENTION_UNRESOLVED_REASONS = [
  "file_absent",
  "entry_absent",
  "anchor_not_allowed",
  "file_unsafe",
  "workspace_unavailable",
] as const;

export const INVALID_ACCOUNT_OBJECTIVE_REASONS = [
  "too_large",
  "outcome_missing",
  "saved_brief_not_found",
  "saved_brief_unsafe",
  "workspace_unavailable",
  "invalid",
] as const;
export type InvalidAccountObjectiveReason = (typeof INVALID_ACCOUNT_OBJECTIVE_REASONS)[number];

const unixSeconds = z.number().int().nonnegative();
const hashSchema = z.string().min(1).max(128);
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const savedBriefPathSchema = z.string().regex(/^objectives\/[a-z0-9][a-z0-9-]{1,62}\.md$/);

/* ------------------------------------------------------------------------------------------------
 * Input (ADR-549-26)
 * ---------------------------------------------------------------------------------------------- */

export const accountObjectiveInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("relationship_only") }).strict(),
  z.object({
    kind: z.literal("commercial"),
    brief: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("inline"), text: z.string() }).strict(),
      // The path grammar is checked during normalization so a bad path is `saved_brief_unsafe`.
      z.object({ kind: z.literal("saved"), path: z.string().min(1) }).strict(),
    ]),
  }).strict(),
]);
export type AccountObjectiveInput = z.infer<typeof accountObjectiveInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Record (ADR-549-20)
 * ---------------------------------------------------------------------------------------------- */

export const objectiveProductEntrySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(300),
  oneLiner: z.string().max(300).nullable(),
  proofPointCount: z.number().int().nonnegative(),
}).strict();

export const objectiveMentionSchema = z.object({
  raw: z.string().min(1).max(100),
  path: z.enum(OBJECTIVE_MENTION_FILES),
  anchor: slugSchema.nullable(),
  resolved: z.object({
    fileHash: hashSchema,
    excerpt: z.string().max(8 * 1024),
    excerptHash: hashSchema,
    /** Set for a resolved `@PRODUCTS.md#<slug>` entry. */
    entry: objectiveProductEntrySchema.nullable(),
  }).strict().nullable(),
  /** Why `resolved` is null; null when resolved. */
  unresolvedReason: z.enum(OBJECTIVE_MENTION_UNRESOLVED_REASONS).nullable(),
}).strict();
export type ObjectiveMention = z.infer<typeof objectiveMentionSchema>;

export const objectiveBriefParsedSchema = z.object({
  outcome: z.string().max(600).nullable(),
  fit: z.string().max(600).nullable(),
  unknowns: z.array(z.string().max(400)).max(12),
  nextStep: z.string().max(600).nullable(),
  success: z.string().max(600).nullable(),
}).strict();

export const objectiveOfferingSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(300),
  oneLiner: z.string().max(300).nullable(),
  proofPointCount: z.number().int().nonnegative(),
  mentionIndex: z.number().int().nonnegative(),
}).strict();

export const objectiveBriefSnapshotSchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("inline") }).strict(),
    z.object({ kind: z.literal("saved"), path: savedBriefPathSchema, fileHash: hashSchema }).strict(),
  ]),
  text: z.string().max(OBJECTIVE_BRIEF_MAX_CHARS),
  hash: hashSchema,
}).strict();

export const accountObjectiveSchema = z.object({
  schemaVersion: z.literal(ACCOUNT_OBJECTIVE_SCHEMA_VERSION),
  objectiveId: z.string().regex(/^aobj_[A-Za-z0-9_-]{6,}$/),
  kind: z.enum(ACCOUNT_OBJECTIVE_KINDS),
  brief: objectiveBriefSnapshotSchema.nullable(),
  parsed: objectiveBriefParsedSchema.nullable(),
  mentions: z.array(objectiveMentionSchema).max(24),
  offering: objectiveOfferingSchema.nullable(),
  limitations: z.array(z.enum(ACCOUNT_OBJECTIVE_LIMITATIONS)),
  sourceHash: hashSchema,
  source: z.enum(ACCOUNT_OBJECTIVE_SOURCES),
  authoredAt: unixSeconds,
  hash: hashSchema,
}).strict().superRefine((objective, ctx) => {
  if (objective.kind === "relationship_only") {
    if (objective.brief || objective.parsed || objective.offering || objective.mentions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a relationship_only objective carries no brief, parsed fields, mentions or offering",
      });
    }
    if (objective.limitations.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitations"], message: "relationship_only carries no limitations" });
    }
  } else if (!objective.brief || !objective.parsed?.outcome) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parsed", "outcome"], message: "a commercial objective requires a brief with an Outcome" });
  }
  if (Buffer.byteLength(canonicalJson(objective), "utf8") > ACCOUNT_OBJECTIVE_MAX_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "account objective exceeds 64 KiB" });
  }
});
export type AccountObjective = z.infer<typeof accountObjectiveSchema>;

/** The reference every writing intent on a scoped launch carries (ADR-549-7). */
export const accountObjectiveRefSchema = z.object({
  objectiveId: z.string().regex(/^aobj_[A-Za-z0-9_-]{6,}$/),
  hash: hashSchema,
}).strict();
export type AccountObjectiveRef = z.infer<typeof accountObjectiveRefSchema>;

export function readAccountObjective(value: unknown): AccountObjective | null {
  const parsed = accountObjectiveSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function computeAccountObjectiveHash(record: Omit<AccountObjective, "hash"> | AccountObjective): string {
  const { hash: _hash, ...rest } = record as AccountObjective;
  return sha256Canonical(rest);
}

/* ------------------------------------------------------------------------------------------------
 * Objective sources (ADR-549-24 / -27)
 * ---------------------------------------------------------------------------------------------- */

export type ObjectiveSourceEntry = {
  /** `objectives/<name>.md`, a whole-file mention path, or `PRODUCTS.md#<slug>`. */
  key: string;
  kind: "saved_brief" | "file" | "entry";
  path: string;
  anchor: string | null;
  /** File hash for a saved brief or whole-file mention; the entry excerpt hash for `#<slug>`. */
  hash: string;
};

/**
 * The sources a run's objective was snapshotted from, in snapshot order.
 *
 * An anchored PRODUCTS.md mention is keyed by its entry and compared by the entry excerpt, so
 * editing a different product in the same file does not mark this run's objective stale.
 */
export function objectiveSourceEntries(
  objective: Pick<AccountObjective, "brief" | "mentions">,
): ObjectiveSourceEntry[] {
  const entries: ObjectiveSourceEntry[] = [];
  if (objective.brief?.source.kind === "saved") {
    entries.push({
      key: objective.brief.source.path,
      kind: "saved_brief",
      path: objective.brief.source.path,
      anchor: null,
      hash: objective.brief.source.fileHash,
    });
  }
  for (const mention of objective.mentions) {
    if (!mention.resolved) continue;
    entries.push(mention.anchor
      ? {
          key: `${mention.path}#${mention.anchor}`,
          kind: "entry",
          path: mention.path,
          anchor: mention.anchor,
          hash: mention.resolved.excerptHash,
        }
      : {
          key: mention.path,
          kind: "file",
          path: mention.path,
          anchor: null,
          hash: mention.resolved.fileHash,
        });
  }
  return entries;
}

export function computeObjectiveSourceHash(entries: Array<{ key: string; hash: string | null }>): string {
  return sha256Canonical(
    entries
      .map((entry) => [entry.key, entry.hash] as const)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Mention resolution (shared by dispatch normalization and the dialog preview)
 * ---------------------------------------------------------------------------------------------- */

type ResourceRead = { file: WorkspaceResourceFile | null; unsafe: boolean };

function makeResourceReader(workspace: PersonalityWorkspace | null) {
  const cache = new Map<string, ResourceRead>();
  return (path: (typeof OBJECTIVE_MENTION_FILES)[number]): ResourceRead | null => {
    if (!workspace) return null;
    const cached = cache.get(path);
    if (cached) return cached;
    let read: ResourceRead;
    try {
      read = { file: readWorkspaceResource(workspace, path), unsafe: false };
    } catch {
      read = { file: null, unsafe: true };
    }
    cache.set(path, read);
    return read;
  };
}

function resolveMentions(
  tokens: ObjectiveBriefMentionToken[],
  workspace: PersonalityWorkspace | null,
): ObjectiveMention[] {
  const read = makeResourceReader(workspace);
  const catalogs = new Map<string, ProductEntry[]>();
  return tokens.map((token) => {
    const unresolved = (reason: (typeof OBJECTIVE_MENTION_UNRESOLVED_REASONS)[number]): ObjectiveMention => ({
      raw: token.raw,
      path: token.path,
      anchor: token.anchor,
      resolved: null,
      unresolvedReason: reason,
    });
    if (token.anchor && token.path !== "PRODUCTS.md") return unresolved("anchor_not_allowed");
    const result = read(token.path);
    if (!result) return unresolved("workspace_unavailable");
    if (result.unsafe) return unresolved("file_unsafe");
    if (!result.file) return unresolved("file_absent");
    const file = result.file;
    if (!token.anchor) {
      const excerpt = boundExcerpt(file.content);
      return {
        raw: token.raw,
        path: token.path,
        anchor: null,
        resolved: { fileHash: file.fileHash, excerpt, excerptHash: sha256(excerpt), entry: null },
        unresolvedReason: null,
      };
    }
    let catalog = catalogs.get(file.fileHash);
    if (!catalog) {
      catalog = parseProductsCatalog(file.content);
      catalogs.set(file.fileHash, catalog);
    }
    const entry = catalog.find((candidate) => candidate.slug === token.anchor);
    if (!entry) return unresolved("entry_absent");
    return {
      raw: token.raw,
      path: token.path,
      anchor: token.anchor,
      resolved: {
        fileHash: file.fileHash,
        excerpt: entry.excerpt,
        excerptHash: sha256(entry.excerpt),
        entry: {
          slug: entry.slug,
          name: entry.name,
          oneLiner: entry.oneLiner,
          proofPointCount: entry.proofPointCount,
        },
      },
      unresolvedReason: null,
    };
  });
}

function deriveOfferingAndLimitations(input: {
  parsed: ReturnType<typeof parseObjectiveBrief>;
  mentions: ObjectiveMention[];
}): { offering: AccountObjective["offering"]; limitations: AccountObjectiveLimitation[] } {
  const found = new Set<AccountObjectiveLimitation>();
  const entryMentions = input.mentions
    .map((mention, index) => ({ mention, index }))
    .filter(({ mention }) => mention.path === "PRODUCTS.md" && mention.anchor);
  let offering: AccountObjective["offering"] = null;
  if (entryMentions.length === 0) found.add("offering_missing");
  if (entryMentions.some(({ mention }) => !mention.resolved)) found.add("offering_unresolved");
  if (entryMentions.length > 1) found.add("offering_ambiguous");
  if (entryMentions.length === 1 && entryMentions[0].mention.resolved?.entry) {
    const { mention, index } = entryMentions[0];
    const entry = mention.resolved!.entry!;
    offering = {
      slug: entry.slug,
      name: entry.name,
      oneLiner: entry.oneLiner,
      proofPointCount: entry.proofPointCount,
      mentionIndex: index,
    };
    if (entry.proofPointCount === 0) found.add("offering_proof_missing");
  }
  if (input.mentions.some((mention) => !mention.resolved && !(mention.path === "PRODUCTS.md" && mention.anchor))) {
    found.add("mention_unresolved");
  }
  if (!input.parsed.fit) found.add("fit_missing");
  if (!input.parsed.success) found.add("success_missing");
  return {
    offering,
    limitations: ACCOUNT_OBJECTIVE_LIMITATIONS.filter((code) => found.has(code)),
  };
}

export type ObjectiveBriefPreview = {
  parsed: ReturnType<typeof parseObjectiveBrief>;
  mentions: ObjectiveMention[];
  offering: AccountObjective["offering"];
  limitations: AccountObjectiveLimitation[];
  workspace: "available" | "unavailable";
};

/**
 * Preview what a brief would attach, without dispatching (`POST /api/objectives/preview`).
 *
 * Never refuses: a missing Outcome is reported through `parsed.outcome === null`, and a workspace
 * that cannot be resolved leaves every mention unresolved with that reason.
 */
export async function previewObjectiveBrief(input: {
  text: string;
  resolveWorkspace: () => Promise<PersonalityWorkspace>;
}): Promise<ObjectiveBriefPreview> {
  const text = input.text.slice(0, OBJECTIVE_BRIEF_MAX_CHARS);
  const parsed = parseObjectiveBrief(text);
  const tokens = extractObjectiveMentions(text);
  let workspace: PersonalityWorkspace | null = null;
  if (tokens.length) {
    try {
      workspace = await input.resolveWorkspace();
    } catch {
      workspace = null;
    }
  }
  const mentions = resolveMentions(tokens, workspace);
  return {
    parsed,
    mentions,
    ...deriveOfferingAndLimitations({ parsed, mentions }),
    workspace: tokens.length && !workspace ? "unavailable" : "available",
  };
}

export type ObjectiveMentionTargets = {
  products: Array<{ slug: string; name: string; oneLiner: string | null; proofPointCount: number; token: string }>;
  /** Allowlisted files present in the workspace, in display order (PRODUCTS.md last). */
  files: Array<{ path: (typeof OBJECTIVE_MENTION_FILES)[number]; token: string }>;
  productsFile: "present" | "absent" | "unsafe";
};

const MENTION_FILE_ORDER = ["BRAND.md", "SOUL.md", "IDENTITY.md", "VOICE.md", "PRODUCTS.md"] as const;

/** The `@` list's options (`GET /api/objectives/mentions`). Unsafe files are left out. */
export function listObjectiveMentionTargets(workspace: PersonalityWorkspace): ObjectiveMentionTargets {
  const read = makeResourceReader(workspace);
  const files: ObjectiveMentionTargets["files"] = [];
  for (const path of MENTION_FILE_ORDER) {
    const result = read(path);
    if (result?.file) files.push({ path, token: `@${path}` });
  }
  const products = read("PRODUCTS.md");
  return {
    products: products?.file
      ? parseProductsCatalog(products.file.content).map((entry) => ({
          slug: entry.slug,
          name: entry.name,
          oneLiner: entry.oneLiner,
          proofPointCount: entry.proofPointCount,
          token: `@PRODUCTS.md#${entry.slug}`,
        }))
      : [],
    files,
    productsFile: products?.unsafe ? "unsafe" : products?.file ? "present" : "absent",
  };
}

/* ------------------------------------------------------------------------------------------------
 * Normalization at dispatch (spec §5, ADR-549-26)
 * ---------------------------------------------------------------------------------------------- */

export type AccountObjectiveNormalization =
  | { ok: true; objective: AccountObjective }
  | {
      ok: false;
      reason: InvalidAccountObjectiveReason;
      message: string;
      details: Record<string, unknown>;
    };

/**
 * Accept a previously normalized record as input on re-dispatch (`existingRunId`).
 *
 * Only the operator's choices survive — the kind and the brief text or saved path. The id, hash,
 * snapshot, mentions and limitations are recomputed, so a stored or forged record is never
 * trusted blindly.
 */
export function toAccountObjectiveInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ACCOUNT_OBJECTIVE_SCHEMA_VERSION) return value;
  if (record.kind === "relationship_only") return { kind: "relationship_only" };
  const brief = record.brief && typeof record.brief === "object" ? record.brief as Record<string, unknown> : null;
  const source = brief?.source && typeof brief.source === "object" ? brief.source as Record<string, unknown> : null;
  if (record.kind === "commercial" && source?.kind === "saved" && typeof source.path === "string") {
    return { kind: "commercial", brief: { kind: "saved", path: source.path } };
  }
  if (record.kind === "commercial" && typeof brief?.text === "string") {
    return { kind: "commercial", brief: { kind: "inline", text: brief.text } };
  }
  return value;
}

function refused(
  reason: InvalidAccountObjectiveReason,
  message: string,
  details: Record<string, unknown> = {},
): AccountObjectiveNormalization {
  return { ok: false, reason, message, details };
}

function finalize(record: Omit<AccountObjective, "hash">): AccountObjectiveNormalization {
  const objective = { ...record, hash: computeAccountObjectiveHash(record) };
  if (Buffer.byteLength(canonicalJson(objective), "utf8") > ACCOUNT_OBJECTIVE_MAX_BYTES) {
    return refused("too_large", "The brief and the files it mentions exceed 64 KiB");
  }
  const parsed = accountObjectiveSchema.safeParse(objective);
  if (!parsed.success) {
    return refused("invalid", "The account objective is invalid", { issues: parsed.error.issues });
  }
  return { ok: true, objective: parsed.data };
}

export async function normalizeAccountObjective(input: {
  /** Input shape, a stored record (re-dispatch), or `undefined` for the default. */
  raw: unknown;
  source: AccountObjectiveSource;
  resolveWorkspace: () => Promise<PersonalityWorkspace>;
  now?: number;
}): Promise<AccountObjectiveNormalization> {
  const authoredAt = input.now ?? Math.floor(Date.now() / 1000);
  const base = {
    schemaVersion: ACCOUNT_OBJECTIVE_SCHEMA_VERSION,
    objectiveId: newWritingId("aobj"),
    authoredAt,
  } as const;
  if (input.raw === undefined || input.raw === null) {
    return finalize({
      ...base,
      kind: "relationship_only",
      brief: null,
      parsed: null,
      mentions: [],
      offering: null,
      limitations: [],
      sourceHash: computeObjectiveSourceHash([]),
      source: "default",
    });
  }
  const parsedInput = accountObjectiveInputSchema.safeParse(toAccountObjectiveInput(input.raw));
  if (!parsedInput.success) {
    return refused("invalid", "The account objective is invalid", { issues: parsedInput.error.issues });
  }
  const objectiveInput = parsedInput.data;
  if (objectiveInput.kind === "relationship_only") {
    return finalize({
      ...base,
      kind: "relationship_only",
      brief: null,
      parsed: null,
      mentions: [],
      offering: null,
      limitations: [],
      sourceHash: computeObjectiveSourceHash([]),
      source: input.source,
    });
  }

  let workspace: PersonalityWorkspace | null = null;
  let workspaceError: unknown = null;
  const ensureWorkspace = async () => {
    if (workspace || workspaceError) return workspace;
    try {
      workspace = await input.resolveWorkspace();
    } catch (error) {
      workspaceError = error;
    }
    return workspace;
  };
  const workspaceRefusal = () => refused(
    "workspace_unavailable",
    "Signals cannot reach its RealTimeX workspace to read the files this brief needs",
    workspaceError instanceof AgentToolError ? { code: workspaceError.code } : {},
  );

  let text: string;
  let briefSource: NonNullable<AccountObjective["brief"]>["source"];
  if (objectiveInput.brief.kind === "inline") {
    text = objectiveInput.brief.text;
    briefSource = { kind: "inline" };
    if (text.length > OBJECTIVE_BRIEF_MAX_CHARS) {
      return refused("too_large", "The brief exceeds 16,384 characters");
    }
  } else {
    const path = objectiveInput.brief.path;
    const name = parseObjectiveBriefPath(path);
    if (!name) {
      return refused("saved_brief_unsafe", "A saved brief must be objectives/<name>.md", { path });
    }
    if (!(await ensureWorkspace())) return workspaceRefusal();
    let file: WorkspaceResourceFile | null;
    try {
      file = readSavedObjectiveBrief(workspace!, name);
    } catch (error) {
      const reason = error instanceof AgentToolError
        ? (error.details as { reason?: unknown } | undefined)?.reason
        : undefined;
      if (reason === "brief_too_large") return refused("too_large", "The saved brief exceeds 16,384 characters", { path, name });
      return refused("saved_brief_unsafe", "The saved brief cannot be read safely", { path, name, ...(typeof reason === "string" ? { unsafe: reason } : {}) });
    }
    if (!file) return refused("saved_brief_not_found", "The saved brief is not in the workspace", { path, name });
    text = file.content;
    briefSource = { kind: "saved", path, fileHash: file.fileHash };
  }

  const parsed = parseObjectiveBrief(text);
  if (!parsed.outcome) {
    return refused("outcome_missing", "A Business outcome brief needs a line under ## Outcome", {
      ...(briefSource.kind === "saved" ? { path: briefSource.path } : {}),
    });
  }
  const tokens = extractObjectiveMentions(text);
  if (tokens.length && !(await ensureWorkspace())) return workspaceRefusal();
  const mentions = resolveMentions(tokens, workspace);
  const { offering, limitations } = deriveOfferingAndLimitations({ parsed, mentions });
  const brief = { source: briefSource, text, hash: sha256(text) };
  return finalize({
    ...base,
    kind: "commercial",
    brief,
    parsed,
    mentions,
    offering,
    limitations,
    sourceHash: computeObjectiveSourceHash(objectiveSourceEntries({ brief, mentions })),
    source: input.source,
  });
}
