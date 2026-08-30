import { z } from "zod";
import { approvalEvidenceSchema } from "@/lib/writing/contracts";

const rendererInput: unique symbol = Symbol("signals.personality.rendererInput");
const unixSecondsSchema = z.number().int().nonnegative();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = (prefix: "prp" | "pb" | "pm" | "vp" | "vs") =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,}$`));
const boundedTextSchema = z.string().max(4_096);
const boundedTextArraySchema = z.array(boundedTextSchema).max(50);

export const SOCIAL_PERSONALITY_FILES = [
  "IDENTITY.md",
  "SOUL.md",
  "VOICE.md",
  "BRAND.md",
] as const;

export const PERSONALITY_SECTIONS = {
  identity: "IDENTITY.md",
  boundaries: "SOUL.md",
  voice: "VOICE.md",
  brand: "BRAND.md",
  index: "AGENTS.md",
} as const;

export type PersonalitySection = keyof typeof PERSONALITY_SECTIONS;
export type PersonalityFile = (typeof PERSONALITY_SECTIONS)[PersonalitySection];

export const PERSONALITY_BLOCK_MAX_BYTES = 16_384;

export function markerStart(
  section: PersonalitySection,
  bindingId: `pb_${string}`,
  sourceHash: string,
): string {
  const source = section === "index" ? "" : ` source=${sourceHash.slice(0, 12)}`;
  return `<!-- signals:personality:${section}:start v=1 binding=${bindingId}${source} -->`;
}

export function markerEnd(section: PersonalitySection): string {
  return `<!-- signals:personality:${section}:end -->`;
}

export const publicProfileInputSchema = z.object({
  network: z.string().min(1).max(100),
  url: z.string().min(1).max(2_048),
  displayName: z.string().max(500).nullable(),
}).strict();

export const renderedIdentityInputSchema = z.object({
  contactId: z.string().min(1),
  name: z.string().min(1).max(500),
  preferredName: z.string().max(500).nullable(),
  headline: boundedTextSchema.nullable(),
  bio: boundedTextSchema.nullable(),
  currentRole: z.object({
    title: z.string().min(1).max(500),
    orgName: z.string().min(1).max(500),
  }).strict().nullable(),
  website: z.string().max(2_048).nullable(),
  profiles: z.array(publicProfileInputSchema).max(50),
  representedOrgName: z.string().max(500).nullable(),
}).strict();

export const renderedBrandInputSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(500),
  description: boundedTextSchema.nullable(),
  website: z.string().max(2_048).nullable(),
  industry: z.string().max(500).nullable(),
  companySize: z.string().max(100).nullable(),
  primaryDomain: z.object({
    domain: z.string().min(1).max(500),
    verified: z.boolean(),
  }).strict().nullable(),
  profiles: z.array(publicProfileInputSchema).max(50),
  selfRelationshipTitle: z.string().max(500).nullable(),
}).strict();

const voiceLineSchema = z.object({
  id: idSchema("vs"),
  text: z.string().max(10_000),
}).strict();

export const renderedVoiceInputSchema = z.object({
  profile: z.object({
    id: idSchema("vp"),
    label: z.string().min(1).max(500),
    version: z.number().int().positive(),
    hash: hashSchema,
  }).strict(),
  platforms: boundedTextArraySchema,
  sentenceLength: z.object({
    median: z.number().nonnegative(),
    range: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  }).strict().nullable(),
  openers: boundedTextArraySchema,
  closers: boundedTextArraySchema,
  punctuation: boundedTextArraySchema,
  formats: boundedTextArraySchema,
  emoji: boundedTextArraySchema,
  hashtags: boundedTextArraySchema,
  vocabulary: z.object({
    keep: boundedTextArraySchema,
    avoid: boundedTextArraySchema,
  }).strict(),
  protectedQuirks: boundedTextArraySchema,
  taboo: boundedTextArraySchema,
  signatureLines: z.array(voiceLineSchema).max(50),
  exemplars: z.array(voiceLineSchema).max(50),
}).strict();

export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;
export type RenderedIdentityInput = z.infer<typeof renderedIdentityInputSchema> & {
  readonly [rendererInput]: "identity";
};
export type RenderedBrandInput = z.infer<typeof renderedBrandInputSchema> & {
  readonly [rendererInput]: "brand";
};
export type RenderedVoiceInput = z.infer<typeof renderedVoiceInputSchema> & {
  readonly [rendererInput]: "voice";
};

function brand<T extends object, K extends "identity" | "brand" | "voice">(
  value: T,
  kind: K,
): T & { readonly [rendererInput]: K } {
  Object.defineProperty(value, rendererInput, { value: kind, enumerable: false });
  return value as T & { readonly [rendererInput]: K };
}

export function brandRenderedIdentityInput(value: unknown): RenderedIdentityInput {
  return brand(renderedIdentityInputSchema.parse(value), "identity");
}

export function brandRenderedBrandInput(value: unknown): RenderedBrandInput {
  return brand(renderedBrandInputSchema.parse(value), "brand");
}

export function brandRenderedVoiceInput(value: unknown): RenderedVoiceInput {
  return brand(renderedVoiceInputSchema.parse(value), "voice");
}

const statementSchema = z.string().max(280);

export const personalityStatementsInputSchema = z.object({
  values: z.array(statementSchema).max(12),
  boundaries: z.array(statementSchema).max(12),
}).strict();

export const personalityStatementsSchema = personalityStatementsInputSchema.extend({
  schemaVersion: z.literal(1),
  updatedAt: unixSecondsSchema,
  hash: hashSchema,
}).strict();

export type PersonalityStatementsInput = z.infer<typeof personalityStatementsInputSchema>;
export type PersonalityStatements = z.infer<typeof personalityStatementsSchema>;

export type PersonalitySources = {
  identity: RenderedIdentityInput;
  brand: RenderedBrandInput | null;
  voice: RenderedVoiceInput | null;
  statements: PersonalityStatements | null;
};

export const personalitySourcesSchema = z.object({
  identity: renderedIdentityInputSchema,
  brand: renderedBrandInputSchema.nullable(),
  voice: renderedVoiceInputSchema.nullable(),
  statements: personalityStatementsSchema.nullable(),
}).strict();

export const personalitySourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  self: z.object({
    contactId: z.string().min(1),
    revision: unixSecondsSchema,
    input: renderedIdentityInputSchema,
  }).strict(),
  org: z.object({
    orgId: z.string().min(1),
    revision: unixSecondsSchema,
    input: renderedBrandInputSchema,
  }).strict().nullable(),
  voice: z.object({
    id: idSchema("vp"),
    version: z.number().int().positive(),
    hash: hashSchema,
    input: renderedVoiceInputSchema,
  }).strict().nullable(),
  statements: z.object({
    hash: hashSchema,
    values: z.array(statementSchema).max(12),
    boundaries: z.array(statementSchema).max(12),
  }).strict().nullable(),
}).strict();

export type PersonalitySourceSnapshot = z.infer<typeof personalitySourceSnapshotSchema>;

export const sourceRevisionsSchema = z.object({
  self: unixSecondsSchema,
  org: unixSecondsSchema.optional(),
  voice: z.object({
    id: idSchema("vp"),
    version: z.number().int().positive(),
    hash: hashSchema,
  }).strict().optional(),
  statements: hashSchema.optional(),
}).strict();

export type PersonalitySourceRevisions = z.infer<typeof sourceRevisionsSchema>;

const workspaceSchema = z.object({
  slug: z.string().min(1),
  id: z.string().min(1).nullable(),
  dir: z.string().min(1),
  key: z.string().min(1),
}).strict();

const bindingIdentitySchema = z.object({
  selfContactId: z.string().min(1),
  representedOrgId: z.string().min(1).nullable(),
}).strict();

const approvalSchema = z.object({
  by: z.literal("user"),
  at: unixSecondsSchema,
  evidence: approvalEvidenceSchema,
}).strict();

const bindingFileSchema = z.object({
  path: z.enum([...SOCIAL_PERSONALITY_FILES, "AGENTS.md"]),
  section: z.enum(["identity", "boundaries", "voice", "brand", "index"]),
  fileHash: hashSchema.nullable(),
  blockHash: hashSchema.nullable(),
}).strict();

export const personalityBindingSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema("pb"),
  proposalId: idSchema("prp"),
  kind: z.enum(["projection", "rollback", "unbind"]),
  workspace: workspaceSchema,
  identity: bindingIdentitySchema,
  sourceHash: z.union([hashSchema, z.literal("")]),
  sourceRevisions: sourceRevisionsSchema.nullable(),
  files: z.array(bindingFileSchema).max(5),
  personalityHash: hashSchema,
  approval: approvalSchema,
  appliedAt: unixSecondsSchema,
  previousBindingId: idSchema("pb").nullable(),
  hostTransactionId: z.string().min(8).max(200),
}).strict();

export type PersonalityBinding = z.infer<typeof personalityBindingSchema>;

const proposalFileSchema = z.object({
  path: z.enum([...SOCIAL_PERSONALITY_FILES, "AGENTS.md"]),
  section: z.enum(["identity", "boundaries", "voice", "brand", "index"]),
  exists: z.boolean(),
  bindingFileHash: hashSchema.nullable(),
  currentFileHash: hashSchema.nullable(),
  currentBlockHash: hashSchema.nullable(),
  proposedBlock: z.string().nullable(),
  proposedBlockHash: hashSchema.nullable(),
  proposedFile: z.string().nullable(),
  proposedFileHash: hashSchema.nullable(),
  unmanagedBytes: z.number().int().nonnegative(),
  driftDiff: z.string().nullable(),
  diff: z.string(),
  repair: z.enum(["duplicate_block", "missing_end_marker"]).optional(),
}).strict();

export const personalityProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema("prp"),
  kind: z.enum(["projection", "rollback", "unbind"]),
  proposedBindingId: idSchema("pb"),
  workspace: workspaceSchema,
  identity: bindingIdentitySchema,
  basedOnBindingId: idSchema("pb").nullable(),
  sourceSnapshot: personalitySourceSnapshotSchema.nullable(),
  sourceHash: z.union([hashSchema, z.literal("")]),
  files: z.array(proposalFileSchema).max(5),
  shim: z.object({ createClaudeSymlink: z.boolean() }).strict(),
  preflight: z.object({ warnings: z.array(z.string()) }).strict(),
  intentHash: hashSchema,
  proposalHash: hashSchema,
  noop: z.boolean(),
  proposedBy: z.object({
    kind: z.enum(["ui", "tool"]),
    workflowRunId: z.string().min(1).optional(),
    rtxThreadSlug: z.string().min(1).optional(),
    at: unixSecondsSchema,
  }).strict(),
}).strict();

export type PersonalityProposal = z.infer<typeof personalityProposalSchema>;

export const proposalStateSchema = z.enum([
  "proposed",
  "approved",
  "applying",
  "applied",
  "apply_failed",
  "rejected",
  "superseded",
  "stale",
]);

const hostTransactionStatusSchema = z.enum([
  "committed",
  "restored_failure",
  "recovery_required",
  "not_started",
]);

export const personalityProposalRecordSchema = z.object({
  state: proposalStateSchema,
  workspaceKey: z.string().min(1),
  updatedAt: unixSecondsSchema,
  approval: approvalSchema.nullable(),
  attempt: z.object({
    bindingId: idSchema("pb"),
    attemptNo: z.number().int().positive(),
    hostTransactionId: z.string().min(8).max(200),
    phase: z.enum(["prepared", "submitted", "committing", "terminal"]),
    startedAt: unixSecondsSchema,
  }).strict().nullable(),
  failure: z.object({
    step: z.string().min(1),
    reason: z.string().min(1),
    hostRecovery: z.object({
      transactionId: z.string().min(8).max(200),
      status: hostTransactionStatusSchema,
    }).strict().optional(),
  }).strict().nullable(),
  hostResult: z.object({
    status: hostTransactionStatusSchema,
    shim: z.object({
      requested: z.boolean(),
      created: z.boolean(),
      state: z.enum(["symlink", "regular_file", "missing", "copy"]),
      error: z.string().optional(),
    }).strict(),
    replayed: z.boolean(),
  }).strict().nullable(),
}).strict();

export type PersonalityProposalRecord = z.infer<typeof personalityProposalRecordSchema>;

export const personalityIndexSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number().int().nonnegative(),
  bindings: z.record(z.string(), z.object({
    workspaceSlug: z.string().min(1),
    workspaceId: z.string().min(1).nullable(),
    workspaceDir: z.string().min(1),
    active: personalityBindingSchema.nullable(),
    history: z.array(personalityBindingSchema).max(50),
  }).strict()),
  proposals: z.record(idSchema("prp"), personalityProposalRecordSchema),
  updatedAt: unixSecondsSchema,
}).strict();

export type PersonalityIndex = z.infer<typeof personalityIndexSchema>;

export const personalityDriftReasonSchema = z.enum([
  "block_edited",
  "block_missing",
  "file_missing",
  "duplicate_block",
  "unmanaged_edited",
  "marker_binding_mismatch",
  "index_pointer_missing",
]);

export const personalityStatusSchema = z.object({
  workspace: z.object({
    slug: z.string().min(1),
    dir: z.string().min(1).nullable(),
  }).strict(),
  binding: personalityBindingSchema.pick({
    id: true,
    sourceHash: true,
    personalityHash: true,
    appliedAt: true,
    identity: true,
    files: true,
  }).nullable(),
  currentSourceHash: hashSchema.nullable(),
  status: z.enum(["bound", "source_stale", "drifted", "unbound", "unavailable"]),
  detail: z.object({
    sourceStale: z.object({
      self: z.boolean().optional(),
      org: z.boolean().optional(),
      voice: z.boolean().optional(),
      statements: z.boolean().optional(),
    }).strict().optional(),
    drifted: z.array(z.object({
      path: z.string().min(1),
      reason: personalityDriftReasonSchema,
    }).strict()).optional(),
    unavailable: z.string().min(1).optional(),
  }).strict().optional(),
  compatibleTargets: z.array(z.string()),
  host: z.object({
    capability: z.enum(["available", "not_granted", "unsupported", "unreachable"]),
    version: z.number().int().positive().nullable(),
  }).strict(),
}).strict();

export type PersonalityStatus = z.infer<typeof personalityStatusSchema>;
export type PersonalityStatusReason =
  | z.infer<typeof personalityDriftReasonSchema>
  | "self_contact_missing"
  | "org_not_represented"
  | "voice_not_self_owned"
  | "workspace_mismatch"
  | "host_capability_unavailable";

export const targetRepresentationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unbound") }).strict(),
  z.object({ kind: z.literal("self"), contactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("org"), orgId: z.string().min(1) }).strict(),
]);

export type TargetRepresentation = z.infer<typeof targetRepresentationSchema>;

export const PRESENCE_MANDATE_MODES = ["assist_only"] as const;

export const presenceMandateSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema("pm"),
  workspaceKey: z.string().min(1),
  mode: z.enum(PRESENCE_MANDATE_MODES),
  targets: z.array(z.object({
    targetId: z.string().min(1),
    actions: z.array(z.enum(["draft", "audit", "propose_reply"])),
  }).strict()),
  cadence: z.null(),
  approvalPolicy: z.literal("explicit"),
  updatedAt: unixSecondsSchema,
  hash: hashSchema,
}).strict();

export type PresenceMandate = z.infer<typeof presenceMandateSchema>;

export type PresenceLedgerEntry = {
  at: number;
  workspaceKey: string;
  targetId?: string;
  kind: "observed" | "decided" | "drafted" | "approved" | "executed" | "verified" | "learned";
  ref: {
    variantId?: string;
    contentItemId?: string;
    publishJobId?: string;
    contentPostId?: string;
    workflowRunId?: string;
  };
  personality?: { bindingId: `pb_${string}` };
  mandateId?: `pm_${string}`;
};
