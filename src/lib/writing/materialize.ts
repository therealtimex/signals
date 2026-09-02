import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import {
  contentItems,
  graphEdges,
  launches,
  mediaAttachments,
  platformTargets,
  variants,
} from "@/lib/db/schema";
import { AgentToolError } from "@/lib/agent-tools/types";
import { mergeContentWriting, readContentWriting } from "@/lib/writing/content-writing";
import {
  type ApprovalEvidence,
  type ApprovalState,
  completeLaunchWritingSchema,
  variantGenerationSchema,
  variantWritingSchema,
} from "@/lib/writing/contracts";
import { computeAuditInputHash } from "@/lib/writing/hash";
import {
  personalityGateFailure,
  type PersonalityWritingGuard,
  withPersonalityWritingGuard,
} from "@/lib/writing/personality-guard";
import { revokeWritingVariantWithRunner } from "@/lib/writing/personality-revocation";
import { isAssistOnlySurface } from "@/lib/writing/capabilities";
import { contentTypeForSurface } from "@/lib/writing/surfaces";
import { isAssistOnlyIntent } from "@/lib/writing/writing-intent";

type MaterializeApproval = { by: "user"; evidence: ApprovalEvidence; note?: string };
const LANE = new Set(["queued", "publishing", "published", "scheduled"]);

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findMaterializedEdge(tx: DbRunner, variantId: string) {
  return tx.select().from(graphEdges).where(and(eq(graphEdges.srcType, "variant"), eq(graphEdges.srcId, variantId), eq(graphEdges.edgeType, "materialized_as"))).get();
}

function effectiveApproval(input: {
  stored: ReturnType<typeof variantWritingSchema.parse>["approval"];
  auditId: string;
  call?: MaterializeApproval;
  now: number;
}): ApprovalState {
  if (input.stored.state === "approved" && input.stored.auditId === input.auditId && input.stored.at && input.stored.by) return input.stored;
  if (input.call) {
    return { ...input.stored, state: "approved", auditId: input.auditId, by: "user", at: input.now, evidence: input.call.evidence, ...(input.call.note ? { note: input.call.note } : {}) };
  }
  throw new AgentToolError("APPROVAL_REQUIRED", "Current user approval is required");
}

function snapshotMatches(item: typeof contentItems.$inferSelect, writing: ReturnType<typeof variantWritingSchema.parse>, approval: ApprovalState): boolean {
  const stored = readContentWriting(item);
  const storedMedia = object(stored?.media).assetIds;
  return Boolean(
    stored &&
    item.status === "approved" &&
    item.body === writing.units.texts[0] &&
    JSON.stringify(stored.units) === JSON.stringify(writing.units) &&
    stored.targetId === writing.targetId &&
    stored.capability.publish === writing.capability.publish &&
    JSON.stringify(storedMedia ?? []) === JSON.stringify(writing.media?.assetIds ?? []) &&
    JSON.stringify(stored.voiceProfile ?? null) === JSON.stringify(writing.voiceProfile) &&
    stored.formulaId === writing.formulaId &&
    JSON.stringify(stored.overlay) === JSON.stringify(writing.overlay) &&
    JSON.stringify(stored.core) === JSON.stringify(writing.core) &&
    stored.materialization?.auditId === writing.audit?.id &&
    stored.materialization?.inputHash === writing.audit?.inputHash &&
    stored.materialization?.approvalAt === approval.at &&
    stored.materialization?.approvalBy === approval.by &&
    JSON.stringify(stored.personality ?? null) === JSON.stringify(writing.personality ?? null) &&
    JSON.stringify(stored.intent ?? null) === JSON.stringify(writing.intent ?? null),
  );
}

function findAdoption(tx: DbRunner, variantId: string, platform: string) {
  return tx.select().from(contentItems).all().find((item) => {
    if (item.platformTarget !== platform || LANE.has(item.status)) return false;
    const writing = object(object(item.platformData).writing);
    const origin = object(writing.origin);
    return origin.variantId === variantId;
  });
}

function replaceMedia(tx: DbRunner, contentItemId: string, assetIds: string[]): void {
  tx.delete(mediaAttachments).where(and(eq(mediaAttachments.parentType, "content_item"), eq(mediaAttachments.parentId, contentItemId), eq(mediaAttachments.role, "attachment"))).run();
  const now = Math.floor(Date.now() / 1000);
  assetIds.forEach((mediaAssetId, sortOrder) => tx.insert(mediaAttachments).values({ id: nanoid(), mediaAssetId, parentType: "content_item", parentId: contentItemId, role: "attachment", sortOrder, source: "signals-writing", createdAt: now, updatedAt: now }).run());
}

function resolveTargetById(tx: DbRunner, id: string) {
  const target = tx.select().from(platformTargets).where(eq(platformTargets.id, id)).get();
  return target?.status === "merged" && target.mergedIntoTargetId
    ? tx.select().from(platformTargets).where(eq(platformTargets.id, target.mergedIntoTargetId)).get()
    : target;
}

type MaterializeGateError = {
  gateError: {
    message: string;
    reason: string;
  };
};

export function materializeVariantWithRunner(
  input: { variantId: string; approval?: MaterializeApproval },
  personalityGuard?: PersonalityWritingGuard,
  tx: DbRunner = db,
) {
  const variant = tx.select().from(variants).where(eq(variants.id, input.variantId)).get();
  if (!variant) throw new AgentToolError("NOT_FOUND", `Variant not found: ${input.variantId}`);
  const generationResult = variantGenerationSchema.safeParse(object(variant.generationMetadata));
  const writingResult = variantWritingSchema.safeParse(object(variant.metadata).writing);
  if (!generationResult.success || !writingResult.success) throw new AgentToolError("VALIDATION_ERROR", "Variant is not a valid Signals writing variant");
  const writing = writingResult.data;
  const launch = tx.select().from(launches).where(eq(launches.id, variant.launchId)).get();
  const launchWritingResult = completeLaunchWritingSchema.safeParse(object(launch?.metadata).writing);
  if (!launch || !launchWritingResult.success || !launchWritingResult.data.spine) throw new AgentToolError("AUDIT_STALE", "Writing launch or spine is missing");
  if (writing.spine.id !== launchWritingResult.data.spine.id || writing.spine.hash !== launchWritingResult.data.spine.hash) throw new AgentToolError("AUDIT_STALE", "Variant spine is stale");
  if (!writing.audit || computeAuditInputHash(variant.body, writing) !== writing.audit.inputHash) throw new AgentToolError("AUDIT_STALE", "Variant audit input is stale");
  if (writing.audit.verdict === "block") throw new AgentToolError("AUDIT_BLOCKED", "Blocked writing variants cannot be materialized");
  if (writing.personality) {
    if (!personalityGuard) {
      throw new AgentToolError("CONFLICT", "Personality-bound materialization requires the authority guard", {
        reason: "guarded_writer_required",
      });
    }
    const failure = personalityGateFailure({
      snapshot: writing.personality,
      audit: writing.audit.personality,
      auditFindings: writing.audit.findings,
      guard: personalityGuard,
      requireCompatibleTarget:
        writing.capability.publish === "direct" || writing.capability.publish === "beta",
    });
    if (failure) {
      revokeWritingVariantWithRunner(tx, {
        variant,
        reason: failure.revokedReason,
        allowQueuedNoop: true,
      });
      return {
        gateError: {
          message: "Variant Personality authority is stale",
          reason: failure.reason,
        },
      } satisfies MaterializeGateError;
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const approval = effectiveApproval({ stored: writing.approval, auditId: writing.audit.id, call: input.approval, now });
  if ((writing.approval.riskTier === "high" || writing.approval.policy === "explicit") && approval.by !== "user") throw new AgentToolError("APPROVAL_REQUIRED", "This variant requires explicit user approval");
  // A composed `assist_only` proposal always needs a human, whatever policy the launch recorded.
  // Keyed on the surface as well as the intent so a variant persisted before this rule, or one
  // whose provenance was stripped, still cannot be policy-approved into a content item.
  if ((isAssistOnlySurface(writing.surface) || isAssistOnlyIntent(writing.intent)) && approval.by !== "user") {
    throw new AgentToolError("APPROVAL_REQUIRED", "Assist-only writing proposals require explicit user approval");
  }
  if (writing.audit.personality?.statusAtAudit === "source_stale" && (approval.by !== "user" || !approval.evidence)) {
    throw new AgentToolError("APPROVAL_REQUIRED", "Source-stale Personality audits require fresh explicit user approval");
  }
  const publish = writing.capability.publish;
  if (publish === "unsupported") throw new AgentToolError("CAPABILITY_UNSUPPORTED", `Surface ${writing.surface} is unsupported`);
  if (publish === "direct" || publish === "beta") {
    if (!writing.targetId) throw new AgentToolError("TARGET_REQUIRED", "A platform target is required");
    const target = resolveTargetById(tx, writing.targetId);
    if (!target || target.status !== "active" || target.platform !== writing.platform) throw new AgentToolError("TARGET_REQUIRED", "A resolvable matching platform target is required");
  }
  const edge = findMaterializedEdge(tx, variant.id);
  const anchored = variant.contentItemId ? tx.select().from(contentItems).where(eq(contentItems.id, variant.contentItemId)).get() : undefined;
  const edgeItem = edge ? tx.select().from(contentItems).where(eq(contentItems.id, edge.dstId)).get() : undefined;
  const adoption = !anchored && !edgeItem ? findAdoption(tx, variant.id, writing.platform) : undefined;
  const existing = anchored ?? edgeItem ?? adoption;
  const fullyAnchored = Boolean(anchored && edge && edge.dstId === anchored.id);
  if (existing && fullyAnchored && snapshotMatches(existing, writing, approval)) {
    return { contentItemId: existing.id, created: false, updated: false, adopted: false, nextAction: publish === "direct" || publish === "beta" ? "publish" as const : "export" as const, capability: writing.capability };
  }
  if (existing && LANE.has(existing.status)) throw new AgentToolError("CONFLICT", `Cannot revise a ${existing.status} content item`);
  const linkedElsewhere = existing ? tx.select().from(variants).where(and(eq(variants.contentItemId, existing.id), ne(variants.id, variant.id))).get() : undefined;
  if (linkedElsewhere) throw new AgentToolError("CONFLICT", "Content item is already linked to another variant", { reason: "content_item_already_linked" });
  const contentItemId = existing?.id ?? nanoid();
  const priorWriting = existing ? readContentWriting(existing) : null;
  const snapshot = {
      schemaVersion: 1 as const,
      variantId: variant.id,
      launchId: variant.launchId,
      platform: writing.platform,
      surface: writing.surface,
      ...(writing.targetId ? { targetId: writing.targetId } : {}),
      units: writing.units,
      capability: writing.capability,
      voiceProfile: writing.voiceProfile,
      formulaId: writing.formulaId,
      overlay: writing.overlay,
      core: writing.core,
      approval: { state: approval.state, by: approval.by, at: approval.at, auditId: approval.auditId, riskTier: approval.riskTier, policy: approval.policy },
      ...(writing.media ? { media: writing.media } : {}),
      ...(writing.personality !== undefined ? { personality: writing.personality } : {}),
      ...(writing.intent !== undefined ? { intent: writing.intent } : {}),
      materialization: { auditId: writing.audit!.id, inputHash: writing.audit!.inputHash, approvalAt: approval.at!, approvalBy: approval.by! },
      origin: priorWriting?.origin ?? { launchId: variant.launchId, variantId: variant.id },
      ...(priorWriting?.idempotencyKey ? { idempotencyKey: priorWriting.idempotencyKey } : {}),
  };
  const platformData = mergeContentWriting(existing?.platformData ?? {}, snapshot);
  const values = { title: variant.label, body: writing.units.texts[0], contentType: contentTypeForSurface(writing.surface), platformTarget: writing.platform, status: "approved" as const, aiGenerated: true, generationPrompt: null, origin: "authored" as const, direction: "outbound" as const, platformData, updatedAt: now };
  if (existing) tx.update(contentItems).set(values).where(eq(contentItems.id, contentItemId)).run();
  else tx.insert(contentItems).values({ id: contentItemId, ...values, createdAt: now }).run();
  replaceMedia(tx, contentItemId, writing.media?.assetIds ?? []);
  const storedWriting = { ...writing, approval, materializedContentItemId: contentItemId };
  tx.update(variants).set({ contentItemId, status: "selected", metadata: JSON.stringify({ ...object(variant.metadata), writing: storedWriting }), updatedAt: now }).where(eq(variants.id, variant.id)).run();
  if (edge) {
    tx.update(graphEdges).set({ dstId: contentItemId, properties: JSON.stringify({ platform: writing.platform, ...(writing.targetId ? { targetId: writing.targetId } : {}), approvalAt: approval.at, by: approval.by }), scope: launch.scope, source: "signals-writing", lastSeenAt: now, updatedAt: now }).where(eq(graphEdges.id, edge.id)).run();
  } else {
    tx.insert(graphEdges).values({ id: nanoid(), srcType: "variant", srcId: variant.id, dstType: "content", dstId: contentItemId, edgeType: "materialized_as", properties: JSON.stringify({ platform: writing.platform, ...(writing.targetId ? { targetId: writing.targetId } : {}), approvalAt: approval.at, by: approval.by }), scope: launch.scope, source: "signals-writing", firstSeenAt: now, lastSeenAt: now }).run();
  }
  return {
    contentItemId,
    created: !existing,
    updated: Boolean(existing),
    adopted: Boolean(adoption),
    nextAction: publish === "direct" || publish === "beta" ? "publish" as const : "export" as const,
    capability: writing.capability,
  };
}

export async function materializeVariant(input: {
  variantId: string;
  approval?: MaterializeApproval;
}) {
  const initial = db.select().from(variants).where(eq(variants.id, input.variantId)).get();
  if (!initial) throw new AgentToolError("NOT_FOUND", `Variant not found: ${input.variantId}`);
  const writing = variantWritingSchema.safeParse(object(initial.metadata).writing);
  const result = writing.success && writing.data.personality
    ? await withPersonalityWritingGuard((guard, tx) => materializeVariantWithRunner(input, guard, tx))
    : db.transaction((tx) => materializeVariantWithRunner(input, undefined, tx));
  if ("gateError" in result && result.gateError) {
    throw new AgentToolError("AUDIT_STALE", result.gateError.message, {
      reason: result.gateError.reason,
    });
  }
  return result;
}
