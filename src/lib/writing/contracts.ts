import { z } from "zod";
import { PLATFORMS } from "@/lib/db/platforms";
import { SURFACE_IDS } from "@/lib/writing/surfaces";
import { parseFormulaId, parseOverlayId, parseRuleId } from "@/lib/writing/ids";
import { writingUnitsSchema } from "@/lib/writing/content-writing";

const unixSeconds = z.number().int().nonnegative();
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,}$`));
const platformSchema = z.enum(PLATFORMS);
export const writingGoalSchema = z.enum(["replies", "reposts", "saves", "likes", "follows", "clicks", "leads", "awareness"]);
export const approvalPolicySchema = z.enum(["explicit", "auto_low_risk"]);
export const generationModeSchema = z.enum(["draft", "adapt", "humanize", "revise"]);
export const voicePrecedenceSchema = z.enum(["voice_first", "rules_first"]);

export const approvalEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread_message"), workspaceSlug: z.string().min(1), threadSlug: z.string().min(1), note: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal("ui"), route: z.string().min(1) }).passthrough(),
  z.object({ kind: z.literal("api"), caller: z.string().min(1) }).passthrough(),
]);
export const userApprovalSchema = z.object({ by: z.literal("user"), at: unixSeconds, evidence: approvalEvidenceSchema }).passthrough();
export const policyApprovalSchema = z.object({ by: z.literal("policy"), at: unixSeconds }).passthrough();

export const sourceSensitivitySchema = z.object({
  level: z.enum(["public", "private"]),
  reason: z.enum(["public_default", "private_content_type", "inbound", "user_marked", "launch_local_only"]),
  contextApproval: userApprovalSchema.optional(),
}).passthrough();

const sourceBase = { id: id("src"), sensitivity: sourceSensitivitySchema };
export const sourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ ...sourceBase, kind: z.literal("content_item"), contentItemId: z.string().min(1), title: z.string().optional(), sha256: z.string().min(1), contentType: z.string().min(1), direction: z.enum(["inbound", "outbound"]).nullable() }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("url"), url: z.string().url(), title: z.string().optional(), retrievedAt: unixSeconds, sha256: z.string().min(1), excerpt: z.string().optional() }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("file"), path: z.string().min(1), sha256: z.string().min(1) }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("note"), text: z.string(), enteredAt: unixSeconds }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("brief"), launchId: z.string().min(1) }).passthrough(),
]);
export const sourceRefInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...sourceBase, kind: z.literal("content_item"), contentItemId: z.string().min(1), title: z.string().optional(), sha256: z.string().min(1).optional(), contentType: z.string().optional(), direction: z.enum(["inbound", "outbound"]).nullable().optional() }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("url"), url: z.string().url(), title: z.string().optional(), retrievedAt: unixSeconds, sha256: z.string().min(1).optional(), excerpt: z.string().optional() }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("file"), path: z.string().min(1), sha256: z.string().min(1).optional() }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("note"), text: z.string(), enteredAt: unixSeconds }).passthrough(),
  z.object({ ...sourceBase, kind: z.literal("brief"), launchId: z.string().min(1) }).passthrough(),
]);

export const preservedClaimSchema = z.object({
  id: id("clm"),
  kind: z.enum(["fact", "number", "date", "name", "quote", "citation", "outcome"]),
  text: z.string(),
  sourceId: id("src"),
  locator: z.string().optional(),
  verbatimRequired: z.boolean(),
  sensitivity: z.enum(["public", "private"]),
  includeInOutput: z.boolean(),
  outputApproval: userApprovalSchema.optional(),
}).passthrough();

export const evidenceSpineSchema = z.object({
  schemaVersion: z.literal(1), id: id("spn"), launchId: z.string().min(1), goal: writingGoalSchema,
  audience: z.object({ nicheIds: z.array(z.string()), cohortLabel: z.string().optional(), personaHints: z.array(z.string()).optional() }).passthrough(),
  sources: z.array(sourceRefSchema), claims: z.array(preservedClaimSchema),
  message: z.object({ core: z.string().min(1), supporting: z.array(z.string()), proofClaimIds: z.array(id("clm")), opinion: z.array(z.string()).optional(), cta: z.object({ intent: z.enum(["reply", "bookmark", "follow", "click", "share", "none"]), text: z.string().optional() }).passthrough().optional() }).passthrough(),
  extractedBy: z.object({ model: z.string().optional(), workflowRunId: z.string().optional(), at: unixSeconds }).passthrough(), hash: z.string().min(1),
}).passthrough().superRefine((spine, ctx) => {
  const sources = new Set(spine.sources.map((source) => source.id));
  const claims = new Set(spine.claims.map((claim) => claim.id));
  spine.claims.forEach((claim, index) => { if (!sources.has(claim.sourceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", index, "sourceId"], message: "claim sourceId must resolve inside sources" }); });
  spine.message.proofClaimIds.forEach((claimId, index) => { if (!claims.has(claimId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message", "proofClaimIds", index], message: "proof claim must resolve inside claims" }); });
  spine.claims.forEach((claim, index) => {
    if (claim.sensitivity === "private" && claim.includeInOutput && !claim.outputApproval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["claims", index, "outputApproval"], message: "private output claims require user approval" });
    }
  });
});

const voiceSampleSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("content_item"), contentItemId: z.string().min(1), platform: platformSchema, publishedAt: unixSeconds.nullable(), origin: z.enum(["authored", "imported"]), contentPostId: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal("pasted"), pastedAt: unixSeconds, declaredPlatform: platformSchema.optional(), sha256: z.string().min(1) }).passthrough(),
  z.object({ kind: z.literal("file"), path: z.string().min(1), sha256: z.string().min(1), importedAt: unixSeconds }).passthrough(),
]);
const voiceSampleInputSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("content_item"), contentItemId: z.string().min(1), platform: platformSchema, publishedAt: unixSeconds.nullable(), origin: z.enum(["authored", "imported"]), contentPostId: z.string().optional() }).passthrough(),
  z.object({ kind: z.literal("pasted"), pastedAt: unixSeconds, declaredPlatform: platformSchema.optional(), sha256: z.string().min(1).optional() }).passthrough(),
  z.object({ kind: z.literal("file"), path: z.string().min(1), sha256: z.string().min(1).optional(), importedAt: unixSeconds }).passthrough(),
]);
export const voiceSampleSchema = z.object({ id: id("vs"), text: z.string(), source: voiceSampleSourceSchema, authorship: z.literal("self"), approved: z.boolean(), engagement: z.record(z.number()).optional(), excludedReason: z.enum(["ai_generated", "not_self", "duplicate", "user_removed"]).optional() }).passthrough();
const voiceSampleInputSchema = z.object({ id: id("vs"), text: z.string(), source: voiceSampleInputSourceSchema, authorship: z.literal("self"), approved: z.boolean(), engagement: z.record(z.number()).optional(), excludedReason: z.enum(["ai_generated", "not_self", "duplicate", "user_removed"]).optional() }).passthrough();
const voiceContentShape = {
  schemaVersion: z.literal(1), id: id("vp"), label: z.string().min(1), ownerContactId: z.string().nullable(), platforms: z.array(platformSchema), samples: z.array(voiceSampleSchema),
  fingerprint: z.object({ sentenceLength: z.object({ medianWords: z.number().nonnegative(), range: z.tuple([z.number().nonnegative(), z.number().nonnegative()]) }).passthrough(), openers: z.array(z.string()), closers: z.array(z.string()), punctuation: z.array(z.string()), vocabulary: z.object({ keep: z.array(z.string()), avoid: z.array(z.string()) }).passthrough(), formats: z.array(z.string()), emoji: z.enum(["none", "rare", "regular"]), hashtags: z.enum(["none", "rare", "regular"]), protectedQuirks: z.array(z.string()), taboo: z.array(z.string()) }).passthrough(),
  signatureLines: z.array(z.object({ text: z.string(), sampleId: id("vs") }).passthrough()), brand: z.object({ handle: z.string().optional(), link: z.string().optional(), notes: z.string().optional() }).passthrough().optional(), derivedBy: z.object({ method: z.enum(["agent", "manual"]), model: z.string().optional(), workflowRunId: z.string().optional(), rtxThreadSlug: z.string().optional(), at: unixSeconds }).passthrough(),
};
export const voiceProfileInputSchema = z.object({ ...voiceContentShape, id: id("vp").optional(), ownerContactId: z.string().nullable().optional(), samples: z.array(voiceSampleInputSchema) }).passthrough();
export const voiceProfileVersionDocumentSchema = z.object({ ...voiceContentShape, version: z.number().int().positive(), hash: z.string().min(1) }).passthrough();
export const voiceProfileSchema = z.object({ ...voiceContentShape, version: z.number().int().positive(), status: z.enum(["draft", "approved", "superseded", "rejected"]), approval: userApprovalSchema.optional(), supersededBy: z.object({ id: id("vp"), version: z.number().int().positive() }).passthrough().optional(), hash: z.string().min(1) }).passthrough();

export const ruleClassSchema = z.enum(["hard", "claim", "voice", "heuristic", "aesthetic"]);
export const auditFindingSchema = z.object({ code: z.string().refine((value) => parseRuleId(value) !== null, "invalid rule id"), class: ruleClassSchema, severity: z.enum(["blocker", "warning", "info"]), message: z.string().min(1), location: z.object({ unit: z.number().int().nonnegative(), start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional(), excerpt: z.string().optional() }).passthrough().optional(), evidence: z.string().optional(), confidence: z.enum(["low", "medium", "high"]).optional(), sourceRef: z.string().optional(), skippedForVoice: z.boolean().optional() }).passthrough();
export const writingAuditSchema = z.object({
  schemaVersion: z.literal(1), id: id("aud"), variantId: z.string().min(1), inputHash: z.string().min(1), auditedAt: unixSeconds,
  auditor: z.object({ kind: z.literal("agent"), model: z.string().optional(), skillVersion: z.string().min(1), workflowRunId: z.string().optional() }).passthrough(),
  overlay: z.object({ id: z.string().min(1), version: z.number().int().positive() }).passthrough(), core: z.object({ version: z.number().int().positive() }).passthrough(), verdict: z.enum(["pass", "warn", "block"]), findings: z.array(auditFindingSchema),
  claims: z.object({ total: z.number().int().nonnegative(), preserved: z.number().int().nonnegative(), altered: z.array(id("clm")), missing: z.array(id("clm")), invented: z.array(z.object({ text: z.string(), location: z.object({ unit: z.number().int().nonnegative(), start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional(), excerpt: z.string().optional() }).passthrough().optional() }).passthrough()), privateIncluded: z.array(id("clm")) }).passthrough(),
  hard: z.object({ units: z.number().int().positive(), chars: z.array(z.number().int().nonnegative()), limit: z.number().int().nonnegative(), hashtags: z.number().int().nonnegative(), links: z.number().int().nonnegative(), mediaCount: z.number().int().nonnegative() }).passthrough(),
  voice: z.object({ status: z.enum(["applied", "none", "rules_first"]), profileId: z.string().optional(), version: z.number().int().positive().optional(), driftScore: z.number().min(0).optional(), protectedQuirksKept: z.boolean().optional(), skipped: z.array(z.string()) }).passthrough(), heuristics: z.object({ applied: z.array(z.string()), conflicts: z.array(z.string()), skippedForVoice: z.array(z.string()) }).passthrough(),
}).passthrough();

export const approvalStateSchema = z.object({ schemaVersion: z.literal(1), state: z.enum(["pending", "approved", "rejected", "revoked"]), riskTier: z.enum(["low", "medium", "high"]), policy: approvalPolicySchema, auditId: id("aud").optional(), by: z.enum(["user", "policy"]).optional(), at: unixSeconds.optional(), evidence: approvalEvidenceSchema.optional(), note: z.string().optional(), revokedReason: z.enum(["spine_changed", "audit_stale", "user", "voice_superseded"]).optional() }).passthrough();
export const voiceProfileRefSchema = z.object({ id: id("vp"), version: z.number().int().positive(), hash: z.string().min(1) }).passthrough();
export const variantWritingSchema = z.object({
  schemaVersion: z.literal(1), platform: platformSchema, surface: z.enum(SURFACE_IDS), targetId: z.string().min(1).optional(), goal: writingGoalSchema,
  formulaId: z.string().refine((value) => parseFormulaId(value) !== null, "invalid formula id"), overlay: z.object({ id: z.string().min(1), version: z.number().int().positive() }).passthrough(), core: z.object({ version: z.number().int().positive() }).passthrough(), voiceProfile: voiceProfileRefSchema.nullable(), voicePrecedence: voicePrecedenceSchema, spine: z.object({ id: id("spn"), hash: z.string().min(1) }).passthrough(), units: writingUnitsSchema,
  claimMap: z.array(z.object({ claimId: id("clm"), present: z.boolean(), unit: z.number().int().nonnegative().optional(), verbatim: z.boolean().optional() }).passthrough()), audit: writingAuditSchema.nullable(), auditHistory: z.array(z.object({ id: id("aud"), auditedAt: unixSeconds, verdict: z.enum(["pass", "warn", "block"]) }).passthrough()).max(5).optional(), approval: approvalStateSchema,
  lineage: z.object({ derivedFromVariantId: z.string().optional(), adaptedFromContentItemId: z.string().optional(), adaptedFromVariantId: z.string().optional(), sourceIds: z.array(id("src")) }).passthrough(), capability: z.object({ publish: z.enum(["direct", "beta", "draft_only", "export_only", "unsupported"]) }).passthrough(), materializedContentItemId: z.string().optional(), media: z.object({ assetIds: z.array(z.string()).max(10) }).passthrough().optional(),
}).passthrough();

export const writingAuditInputSchema = writingAuditSchema.omit({
  id: true,
  variantId: true,
  inputHash: true,
});

export const variantWritingInputSchema = variantWritingSchema
  .omit({ audit: true, auditHistory: true, approval: true, capability: true, materializedContentItemId: true })
  .extend({ audit: writingAuditInputSchema.nullable() })
  .passthrough();

export const variantGenerationSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("signals-writing"), mode: generationModeSchema, model: z.string().nullable(), skill: z.object({ name: z.literal("signals-writing"), version: z.string().min(1) }).passthrough(), agent: z.object({ workflowRunId: z.string().min(1), rtxThreadSlug: z.string().optional(), rtxRuntimeSessionId: z.string().optional(), briefPath: z.string().optional() }).passthrough(), requestHash: z.string().min(1).max(200), generatedAt: unixSeconds }).passthrough();

const launchSurfaceSchema = z.object({ platform: platformSchema, surface: z.enum(SURFACE_IDS), targetId: z.string().optional() }).passthrough();
const launchRunSchema = z.object({ workflowRunId: z.string().min(1), mode: generationModeSchema, startedAt: unixSeconds, rtxThreadSlug: z.string().optional() }).passthrough();
export const launchWritingSchema = z.object({ schemaVersion: z.literal(1).optional(), goal: writingGoalSchema.optional(), surfaces: z.array(launchSurfaceSchema).optional(), sources: z.array(sourceRefSchema).optional(), spine: evidenceSpineSchema.optional(), voiceProfile: voiceProfileRefSchema.nullable().optional(), voicePrecedence: voicePrecedenceSchema.optional(), approvalPolicy: approvalPolicySchema.optional(), runs: z.array(launchRunSchema).optional() }).passthrough();
export const completeLaunchWritingSchema = z.object({ schemaVersion: z.literal(1), goal: writingGoalSchema, surfaces: z.array(launchSurfaceSchema), sources: z.array(sourceRefSchema), spine: evidenceSpineSchema.optional(), voiceProfile: voiceProfileRefSchema.nullable(), voicePrecedence: voicePrecedenceSchema, approvalPolicy: approvalPolicySchema, runs: z.array(launchRunSchema) }).passthrough();

export const launchWritingPatchSchema = z.object({ schemaVersion: z.literal(1).optional(), goal: writingGoalSchema.optional(), surfaces: z.array(z.object({ platform: platformSchema, surface: z.enum(SURFACE_IDS), targetId: z.string().optional() }).passthrough()).optional(), sources: z.array(sourceRefInputSchema).optional(), spine: z.record(z.unknown()).optional(), voiceProfile: voiceProfileRefSchema.nullable().optional(), voicePrecedence: voicePrecedenceSchema.optional(), approvalPolicy: approvalPolicySchema.optional(), runs: z.array(z.object({ workflowRunId: z.string().min(1), mode: generationModeSchema, startedAt: unixSeconds, rtxThreadSlug: z.string().optional() }).passthrough()).optional() }).passthrough();

export type ApprovalEvidence = z.infer<typeof approvalEvidenceSchema>;
export type EvidenceSpine = z.infer<typeof evidenceSpineSchema>;
export type LaunchWritingDocument = z.infer<typeof launchWritingSchema>;
export type LaunchWriting = z.infer<typeof completeLaunchWritingSchema>;
export type VariantWriting = z.infer<typeof variantWritingSchema>;
export type VariantWritingInput = z.infer<typeof variantWritingInputSchema>;
export type VariantGeneration = z.infer<typeof variantGenerationSchema>;
export type WritingAudit = z.infer<typeof writingAuditSchema>;
export type ApprovalState = z.infer<typeof approvalStateSchema>;
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type VoiceProfileVersionDocument = z.infer<typeof voiceProfileVersionDocumentSchema>;
