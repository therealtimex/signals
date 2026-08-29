import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contentItems, graphEdges, launches, mediaAssets, variants } from "@/lib/db/schema";
import type { Variant } from "@/lib/db/types";
import { resolveTargetById } from "@/lib/db/queries/platform-targets";
import { AgentToolError } from "@/lib/agent-tools/types";
import { deriveAuditVerdict, deriveRiskTier, validateAuditFindingSemantics } from "@/lib/writing/audit";
import { getSurfaceCapabilities } from "@/lib/writing/capabilities";
import {
  type ApprovalState,
  type LaunchWriting,
  type VariantGeneration,
  type VariantWriting,
  completeLaunchWritingSchema,
  variantGenerationSchema,
  variantWritingInputSchema,
  variantWritingSchema,
} from "@/lib/writing/contracts";
import { canonicalJson, computeAuditInputHash } from "@/lib/writing/hash";
import { newWritingId } from "@/lib/writing/ids";
import { syncVariantLineageEdges, type LineageEdgeSummary } from "@/lib/writing/lineage";
import { resolveVoiceProfile } from "@/lib/writing/voice-profile-store";

type PersistInput = {
  id?: string;
  launchId: string;
  label?: string | null;
  body?: string | null;
  status?: Variant["status"];
  predictedScore?: number | null;
  predictionConfidence?: number | null;
  predictedMetrics?: Record<string, unknown>;
  predictionModel?: string | null;
  simulatedAt?: number | null;
  generationMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const PUBLISH_LANE_STATUSES = new Set(["queued", "publishing", "published", "scheduled"]);

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function fail(message: string, reason: string, path?: (string | number)[]): never {
  throw new AgentToolError("VALIDATION_ERROR", message, { reason, ...(path ? { path } : {}) });
}

function readGeneration(variant: Variant | undefined): VariantGeneration | null {
  const parsed = variantGenerationSchema.safeParse(object(variant?.generationMetadata));
  return parsed.success ? parsed.data : null;
}

export function isWritingVariant(variant: Variant | undefined): boolean {
  return readGeneration(variant) !== null;
}

function findByRequestHash(launchId: string, requestHash: string): Variant | undefined {
  return db.select().from(variants).where(eq(variants.launchId, launchId)).all()
    .find((variant) => readGeneration(variant)?.requestHash === requestHash);
}

function deriveHard(input: { units: VariantWriting["units"]; media?: { assetIds: string[] }; limit: number }) {
  const text = input.units.texts.join("\n");
  return {
    units: input.units.count,
    chars: input.units.chars,
    limit: input.limit,
    hashtags: (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length,
    links: (text.match(/https?:\/\/\S+/g) ?? []).length,
    mediaCount: input.media?.assetIds.length ?? 0,
  };
}

function hardLimit(surface: string): number {
  if (surface.startsWith("x/")) return 280;
  if (surface.startsWith("linkedin/")) return 3_000;
  if (surface.startsWith("facebook/")) return 63_206;
  if (surface.startsWith("threads/")) return 500;
  if (surface.startsWith("instagram/")) return 2_200;
  if (surface.startsWith("tiktok/")) return 4_000;
  if (surface === "youtube/title") return 100;
  return 5_000;
}

function auditComparable(audit: Record<string, unknown>) {
  const { id: _id, variantId: _variantId, inputHash: _inputHash, ...rest } = audit;
  return rest;
}

function sameHard(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return ["units", "limit", "hashtags", "links", "mediaCount"].every((key) => a[key] === b[key]) &&
    JSON.stringify(a.chars) === JSON.stringify(b.chars);
}

function approvalFor(input: {
  audit: VariantWriting["audit"];
  launch: LaunchWriting;
  spine: NonNullable<LaunchWriting["spine"]>;
  targetKind?: string;
  existing?: VariantWriting;
  unchanged: boolean;
  now: number;
}): ApprovalState {
  const riskTier = input.audit ? deriveRiskTier(input.audit, input.spine, input.targetKind) : "low";
  if (input.unchanged && input.existing?.approval && input.existing.audit?.id === input.audit?.id) {
    return { ...input.existing.approval, riskTier, policy: input.launch.approvalPolicy };
  }
  if (input.existing?.approval.state === "approved") {
    return {
      ...input.existing.approval,
      state: "revoked",
      riskTier,
      policy: input.launch.approvalPolicy,
      auditId: input.audit?.id,
      at: input.now,
      revokedReason: "audit_stale",
    };
  }
  if (input.audit && input.launch.approvalPolicy === "auto_low_risk" && riskTier === "low" && input.audit.verdict !== "block") {
    return { schemaVersion: 1, state: "approved", riskTier, policy: input.launch.approvalPolicy, auditId: input.audit.id, by: "policy", at: input.now };
  }
  return { schemaVersion: 1, state: "pending", riskTier, policy: input.launch.approvalPolicy, ...(input.audit ? { auditId: input.audit.id } : {}) };
}

function exactSurfaceUnits(surface: string, count: number): boolean {
  return surface === "x/thread" || surface === "threads/thread" ? count >= 2 : count === 1;
}

function validateCrossDocuments(input: {
  variantId: string;
  body?: string | null;
  writing: ReturnType<typeof variantWritingInputSchema.parse>;
  generation: VariantGeneration;
  launch: LaunchWriting;
}) {
  const spine = input.launch.spine;
  if (!spine) fail("Launch has no writing spine", "launch_not_writing");
  if (input.writing.spine.id !== spine.id || input.writing.spine.hash !== spine.hash) fail("Variant spine does not match launch", "spine_mismatch", ["metadata", "writing", "spine"]);
  if (!input.writing.surface.startsWith(`${input.writing.platform}/`)) fail("Surface does not match platform", "surface_platform_mismatch");
  if (!exactSurfaceUnits(input.writing.surface, input.writing.units.count)) fail("Surface has invalid ordered units", "thread_units", ["metadata", "writing", "units"]);
  if (input.body !== undefined && input.body !== null && input.body !== input.writing.units.texts[0]) fail("body must equal ordered unit 0", "body_units_mismatch", ["body"]);
  const claimIds = new Set(spine.claims.map((claim) => claim.id));
  const sourceIds = new Set(spine.sources.map((source) => source.id));
  for (const [index, claim] of input.writing.claimMap.entries()) if (!claimIds.has(claim.claimId)) fail("Claim map references an unknown claim", "claim_unknown", ["metadata", "writing", "claimMap", index, "claimId"]);
  for (const [index, sourceId] of input.writing.lineage.sourceIds.entries()) if (!sourceIds.has(sourceId)) fail("Lineage references an unknown source", "lineage_source_unknown", ["metadata", "writing", "lineage", "sourceIds", index]);
  for (const ref of [input.writing.lineage.derivedFromVariantId, input.writing.lineage.adaptedFromVariantId].filter(Boolean) as string[]) {
    if (!db.select({ id: variants.id }).from(variants).where(eq(variants.id, ref)).get()) throw new AgentToolError("NOT_FOUND", `Lineage variant not found: ${ref}`, { reason: "lineage_ref_not_found" });
  }
  if (input.writing.lineage.adaptedFromContentItemId && !db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, input.writing.lineage.adaptedFromContentItemId)).get()) throw new AgentToolError("NOT_FOUND", `Lineage content item not found: ${input.writing.lineage.adaptedFromContentItemId}`, { reason: "lineage_ref_not_found" });
  let targetKind: string | undefined;
  if (input.writing.targetId) {
    const target = resolveTargetById(input.writing.targetId);
    if (!target || target.status !== "active" || target.platform !== input.writing.platform) fail("Target must be active and match platform", "target_invalid", ["metadata", "writing", "targetId"]);
    targetKind = target.kind;
  }
  if (input.launch.voiceProfile && !input.writing.voiceProfile) fail("Launch requires its voice profile", "voice_profile_required", ["metadata", "writing", "voiceProfile"]);
  if (input.writing.voiceProfile) resolveVoiceProfile(input.writing.voiceProfile);
  for (const assetId of input.writing.media?.assetIds ?? []) if (!db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).get()) throw new AgentToolError("NOT_FOUND", `Media asset not found: ${assetId}`, { reason: "media_asset_not_found" });
  if ((input.generation.mode === "humanize" || input.generation.mode === "revise") && !input.writing.lineage.derivedFromVariantId) fail(`${input.generation.mode} requires a source variant`, "lineage_ref_not_found");
  if (input.generation.mode === "adapt" && !input.writing.lineage.derivedFromVariantId && !input.writing.lineage.adaptedFromVariantId && !input.writing.lineage.adaptedFromContentItemId) fail("adapt requires a source", "lineage_ref_not_found");
  return { spine, targetKind };
}

function deriveLaunchReady(launchId: string, launch: LaunchWriting): void {
  if (!launch.spine || launch.surfaces.length === 0) return;
  const launchRow = db.select().from(launches).where(eq(launches.id, launchId)).get();
  if (!launchRow || ["live", "completed", "archived"].includes(launchRow.status)) return;
  const rows = db.select().from(variants).where(eq(variants.launchId, launchId)).all();
  const complete = launch.surfaces.every((expected) => rows.some((row) => {
    const parsed = variantWritingSchema.safeParse(object(row.metadata).writing);
    if (!parsed.success || parsed.data.surface !== expected.surface || parsed.data.spine.hash !== launch.spine!.hash || !parsed.data.audit) return false;
    return parsed.data.audit.inputHash === computeAuditInputHash(row.body, parsed.data);
  }));
  if (complete) db.update(launches).set({ status: "ready", updatedAt: Math.floor(Date.now() / 1000) }).where(eq(launches.id, launchId)).run();
}

export function persistWritingVariant(input: PersistInput): { variant: Variant; created: boolean; lineageEdges: LineageEdgeSummary[] } {
  if (input.status === "published" || (input.status && input.status !== "draft" && input.status !== "rejected")) fail("Writing variants accept only draft or rejected status", "writing_status_invalid", ["status"]);
  const launchRow = db.select().from(launches).where(eq(launches.id, input.launchId)).get();
  if (!launchRow) throw new AgentToolError("NOT_FOUND", `Launch not found: ${input.launchId}`);
  const launchResult = completeLaunchWritingSchema.safeParse(object(launchRow.metadata).writing);
  if (!launchResult.success || !launchResult.data.spine) fail("Launch has no valid writing spine", "launch_not_writing");
  if (!input.metadata || !Object.prototype.hasOwnProperty.call(input.metadata, "writing")) fail("Full metadata.writing is required", "writing_required", ["metadata", "writing"]);
  const writingResult = variantWritingInputSchema.safeParse(input.metadata.writing);
  if (!writingResult.success) throw new AgentToolError("VALIDATION_ERROR", "Invalid variant writing metadata", writingResult.error.flatten());
  const requestedGeneration = input.generationMetadata;
  let existing = input.id ? db.select().from(variants).where(eq(variants.id, input.id)).get() : undefined;
  const fallbackGeneration = readGeneration(existing);
  const generationResult = variantGenerationSchema.safeParse(requestedGeneration ?? fallbackGeneration);
  if (!generationResult.success) throw new AgentToolError("VALIDATION_ERROR", "Invalid writing generation metadata", generationResult.error.flatten());
  if (!existing && !input.id) existing = findByRequestHash(input.launchId, generationResult.data.requestHash);
  if (input.id && !existing) throw new AgentToolError("NOT_FOUND", `Variant not found: ${input.id}`);
  if (existing && existing.launchId !== input.launchId) fail("Variant launch cannot change", "variant_launch_mismatch", ["launchId"]);
  if (existing) {
    const materializedEdge = existing.contentItemId
      ? undefined
      : db.select().from(graphEdges).where(and(
          eq(graphEdges.srcType, "variant"),
          eq(graphEdges.srcId, existing.id),
          eq(graphEdges.dstType, "content"),
          eq(graphEdges.edgeType, "materialized_as"),
        )).get();
    const contentItemId = existing.contentItemId ?? materializedEdge?.dstId;
    const item = contentItemId
      ? db.select().from(contentItems).where(eq(contentItems.id, contentItemId)).get()
      : undefined;
    if (item && PUBLISH_LANE_STATUSES.has(item.status)) {
      throw new AgentToolError("CONFLICT", `Cannot revise a variant linked to a ${item.status} content item`, {
        reason: "variant_locked",
        contentItemId: item.id,
        status: item.status,
      });
    }
  }
  const variantId = existing?.id ?? nanoid();
  const { spine, targetKind } = validateCrossDocuments({ variantId, body: input.body, writing: writingResult.data, generation: generationResult.data, launch: launchResult.data });
  const now = Math.floor(Date.now() / 1000);
  const existingWritingResult = variantWritingSchema.safeParse(object(existing?.metadata).writing);
  const previous = existingWritingResult.success ? existingWritingResult.data : undefined;
  const inputHash = computeAuditInputHash(writingResult.data.units.texts[0], writingResult.data);
  let audit: VariantWriting["audit"] = null;
  if (writingResult.data.audit) {
    const expectedHard = deriveHard({ units: writingResult.data.units, media: writingResult.data.media, limit: hardLimit(writingResult.data.surface) });
    if (!sameHard(writingResult.data.audit.hard, expectedHard)) fail("Audit hard counts do not match variant", "audit_hard_mismatch", ["metadata", "writing", "audit", "hard"]);
    if (JSON.stringify(writingResult.data.audit.overlay) !== JSON.stringify(writingResult.data.overlay) || JSON.stringify(writingResult.data.audit.core) !== JSON.stringify(writingResult.data.core)) fail("Audit ruleset does not match variant", "audit_overlay_mismatch", ["metadata", "writing", "audit"]);
    const provisional = { ...writingResult.data.audit, id: previous?.audit?.inputHash === inputHash ? previous.audit.id : newWritingId("aud"), variantId, inputHash, hard: expectedHard };
    const sameAudit = Boolean(previous?.audit && previous.audit.inputHash === inputHash && canonicalJson(auditComparable(previous.audit)) === canonicalJson(auditComparable(provisional)));
    const candidate = { ...provisional, id: sameAudit ? previous!.audit!.id : newWritingId("aud") };
    const expectedVoiceStatus = writingResult.data.voicePrecedence === "rules_first"
      ? "rules_first"
      : writingResult.data.voiceProfile
        ? "applied"
        : "none";
    if (candidate.voice.status !== expectedVoiceStatus) fail("Audit voice state does not match variant", "audit_voice_mismatch", ["metadata", "writing", "audit", "voice", "status"]);
    if (writingResult.data.voicePrecedence === "rules_first" && candidate.findings.some((finding) => finding.skippedForVoice)) fail("rules_first cannot skip findings for voice", "audit_voice_mismatch", ["metadata", "writing", "audit", "findings"]);
    const semantic = validateAuditFindingSemantics(candidate);
    if (semantic) fail("Audit finding severity/class is invalid", semantic, ["metadata", "writing", "audit", "findings"]);
    const verdict = deriveAuditVerdict(candidate, spine);
    if (candidate.verdict !== verdict) fail("Submitted audit verdict does not match server verdict", "audit_verdict_mismatch", ["metadata", "writing", "audit", "verdict"]);
    audit = { ...candidate, verdict };
  }
  const unchanged = Boolean(previous?.audit && audit && previous.audit.inputHash === inputHash && previous.audit.id === audit.id);
  const approval = input.status === "rejected"
    ? {
        schemaVersion: 1 as const,
        state: "rejected" as const,
        riskTier: audit ? deriveRiskTier(audit, spine, targetKind) : "low" as const,
        policy: launchResult.data.approvalPolicy,
        ...(audit ? { auditId: audit.id } : {}),
      }
    : approvalFor({ audit, launch: launchResult.data, spine, targetKind, existing: previous, unchanged, now });
  const auditHistory = audit
    ? [{ id: audit.id, auditedAt: audit.auditedAt, verdict: audit.verdict }, ...(previous?.auditHistory ?? []).filter((entry) => entry.id !== audit!.id)].slice(0, 5)
    : (previous?.auditHistory ?? []);
  const writing: VariantWriting = variantWritingSchema.parse({
    ...writingResult.data,
    audit,
    auditHistory,
    approval,
    capability: { publish: getSurfaceCapabilities(writingResult.data.surface).publish },
    ...(previous?.materializedContentItemId ? { materializedContentItemId: previous.materializedContentItemId } : {}),
  });
  const rootMetadata = { ...object(existing?.metadata), ...input.metadata, writing };
  const created = !existing;
  const variantType = writing.surface.endsWith("/thread") ? "thread" : "post";
  const labelSuffix = input.label?.trim();
  const label = labelSuffix && labelSuffix !== writing.surface ? `${writing.surface} · ${labelSuffix.replace(new RegExp(`^${writing.surface}\\s*·?\\s*`), "")}` : writing.surface;
  const status: Variant["status"] = input.status ?? (existing?.status === "selected" && !unchanged ? "draft" : (existing?.status ?? "draft"));
  const lineageEdges = db.transaction(() => {
    if (existing) {
      db.update(variants).set({ label, body: writing.units.texts[0], variantType, status, predictedScore: input.predictedScore ?? existing.predictedScore, predictionConfidence: input.predictionConfidence ?? existing.predictionConfidence, predictedMetrics: input.predictedMetrics ? JSON.stringify(input.predictedMetrics) : existing.predictedMetrics, predictionModel: input.predictionModel ?? existing.predictionModel, simulatedAt: input.simulatedAt ?? existing.simulatedAt, generationModel: generationResult.data.model, generationMetadata: JSON.stringify(generationResult.data), metadata: JSON.stringify(rootMetadata), updatedAt: now }).where(eq(variants.id, variantId)).run();
      if (!unchanged && existing.contentItemId) {
        const item = db.select().from(contentItems).where(eq(contentItems.id, existing.contentItemId)).get();
        if (item?.status === "approved") db.update(contentItems).set({ status: "draft", updatedAt: now }).where(eq(contentItems.id, item.id)).run();
      }
    } else {
      db.insert(variants).values({ id: variantId, launchId: input.launchId, label, variantType, body: writing.units.texts[0], status, predictedScore: input.predictedScore ?? null, predictionConfidence: input.predictionConfidence ?? null, predictedMetrics: JSON.stringify(input.predictedMetrics ?? {}), predictionModel: input.predictionModel ?? null, simulatedAt: input.simulatedAt ?? null, generationModel: generationResult.data.model, generationMetadata: JSON.stringify(generationResult.data), metadata: JSON.stringify(rootMetadata) }).run();
    }
    const edges = syncVariantLineageEdges({ variantId, writing, generation: generationResult.data, spine, scope: launchRow.scope });
    deriveLaunchReady(input.launchId, launchResult.data);
    return edges;
  });
  return { variant: db.select().from(variants).where(eq(variants.id, variantId)).get()!, created, lineageEdges };
}

function revokeOne(
  variant: Variant,
  reason: ApprovalState["revokedReason"],
  note?: string,
  allowPublishLaneStale = false,
): { blocked: boolean } {
  const parsed = variantWritingSchema.safeParse(object(variant.metadata).writing);
  if (!parsed.success) return { blocked: false };
  const item = variant.contentItemId ? db.select().from(contentItems).where(eq(contentItems.id, variant.contentItemId)).get() : undefined;
  const inLane = Boolean(item && PUBLISH_LANE_STATUSES.has(item.status));
  if (inLane && !allowPublishLaneStale) return { blocked: true };
  const now = Math.floor(Date.now() / 1000);
  const writing = {
    ...parsed.data,
    approval: {
      ...parsed.data.approval,
      state: "revoked" as const,
      ...(reason === "user" ? { by: "user" as const } : {}),
      at: now,
      revokedReason: reason,
      ...(note ? { note } : {}),
    },
  };
  db.update(variants).set({ metadata: JSON.stringify({ ...object(variant.metadata), writing }), ...(!inLane && variant.status === "selected" ? { status: "draft" as const } : {}), updatedAt: now }).where(eq(variants.id, variant.id)).run();
  if (!inLane && item?.status === "approved") db.update(contentItems).set({ status: "draft", updatedAt: now }).where(eq(contentItems.id, item.id)).run();
  if (item) {
    const edge = db.select().from(graphEdges).where(and(eq(graphEdges.srcType, "variant"), eq(graphEdges.srcId, variant.id), eq(graphEdges.edgeType, "materialized_as"))).get();
    if (edge) db.update(graphEdges).set({ properties: JSON.stringify({ ...object(edge.properties), revokedAt: now }), updatedAt: now }).where(eq(graphEdges.id, edge.id)).run();
  }
  return { blocked: false };
}

export function revokeVariantApproval(variantId: string, reason: ApprovalState["revokedReason"], note?: string) {
  const variant = db.select().from(variants).where(eq(variants.id, variantId)).get();
  if (!variant) throw new AgentToolError("NOT_FOUND", `Variant not found: ${variantId}`);
  return db.transaction(() => {
    const result = revokeOne(variant, reason, note);
    if (result.blocked) throw new AgentToolError("CONFLICT", "Cannot revoke a variant in the publish lane");
    return variantWritingSchema.parse(object(db.select().from(variants).where(eq(variants.id, variantId)).get()!.metadata).writing).approval;
  });
}

export function revokeVariantsForSpineChange(launchId: string): string[] {
  const revoked: string[] = [];
  for (const variant of db.select().from(variants).where(eq(variants.launchId, launchId)).all()) {
    const parsed = variantWritingSchema.safeParse(object(variant.metadata).writing);
    if (!parsed.success || parsed.data.approval.state !== "approved") continue;
    revokeOne(variant, "spine_changed", undefined, true);
    revoked.push(variant.id);
  }
  return revoked;
}
