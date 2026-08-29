import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contentItems, graphEdges, mediaAttachments, variants } from "@/lib/db/schema";
import { resolveTargetById } from "@/lib/db/queries/platform-targets";
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

type MaterializeApproval = { by: "user"; evidence: ApprovalEvidence; note?: string };
const LANE = new Set(["queued", "publishing", "published", "scheduled"]);

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findMaterializedEdge(variantId: string) {
  return db.select().from(graphEdges).where(and(eq(graphEdges.srcType, "variant"), eq(graphEdges.srcId, variantId), eq(graphEdges.edgeType, "materialized_as"))).get();
}

function effectiveApproval(input: {
  stored: ReturnType<typeof variantWritingSchema.parse>["approval"];
  auditId: string;
  call?: MaterializeApproval;
  now: number;
}): ApprovalState {
  if (input.call) {
    return { ...input.stored, state: "approved", auditId: input.auditId, by: "user", at: input.now, evidence: input.call.evidence, ...(input.call.note ? { note: input.call.note } : {}) };
  }
  if (input.stored.state === "approved" && input.stored.auditId === input.auditId && input.stored.at && input.stored.by) return input.stored;
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
    stored.materialization?.approvalBy === approval.by,
  );
}

function findAdoption(variantId: string, platform: string) {
  return db.select().from(contentItems).all().find((item) => {
    if (item.platformTarget !== platform || LANE.has(item.status)) return false;
    const writing = object(object(item.platformData).writing);
    const origin = object(writing.origin);
    return origin.variantId === variantId;
  });
}

function replaceMedia(contentItemId: string, assetIds: string[]): void {
  db.delete(mediaAttachments).where(and(eq(mediaAttachments.parentType, "content_item"), eq(mediaAttachments.parentId, contentItemId), eq(mediaAttachments.role, "attachment"))).run();
  const now = Math.floor(Date.now() / 1000);
  assetIds.forEach((mediaAssetId, sortOrder) => db.insert(mediaAttachments).values({ id: nanoid(), mediaAssetId, parentType: "content_item", parentId: contentItemId, role: "attachment", sortOrder, source: "signals-writing", createdAt: now, updatedAt: now }).run());
}

export function materializeVariant(input: { variantId: string; approval?: MaterializeApproval }) {
  const variant = db.select().from(variants).where(eq(variants.id, input.variantId)).get();
  if (!variant) throw new AgentToolError("NOT_FOUND", `Variant not found: ${input.variantId}`);
  const generationResult = variantGenerationSchema.safeParse(object(variant.generationMetadata));
  const writingResult = variantWritingSchema.safeParse(object(variant.metadata).writing);
  if (!generationResult.success || !writingResult.success) throw new AgentToolError("VALIDATION_ERROR", "Variant is not a valid Signals writing variant");
  const writing = writingResult.data;
  const launch = db.query.launches.findFirst({ where: (table, { eq }) => eq(table.id, variant.launchId) }).sync();
  const launchWritingResult = completeLaunchWritingSchema.safeParse(object(launch?.metadata).writing);
  if (!launch || !launchWritingResult.success || !launchWritingResult.data.spine) throw new AgentToolError("AUDIT_STALE", "Writing launch or spine is missing");
  if (writing.spine.id !== launchWritingResult.data.spine.id || writing.spine.hash !== launchWritingResult.data.spine.hash) throw new AgentToolError("AUDIT_STALE", "Variant spine is stale");
  if (!writing.audit || computeAuditInputHash(variant.body, writing) !== writing.audit.inputHash) throw new AgentToolError("AUDIT_STALE", "Variant audit input is stale");
  if (writing.audit.verdict === "block") throw new AgentToolError("AUDIT_BLOCKED", "Blocked writing variants cannot be materialized");
  const now = Math.floor(Date.now() / 1000);
  const approval = effectiveApproval({ stored: writing.approval, auditId: writing.audit.id, call: input.approval, now });
  if ((writing.approval.riskTier === "high" || writing.approval.policy === "explicit") && approval.by !== "user") throw new AgentToolError("APPROVAL_REQUIRED", "This variant requires explicit user approval");
  const publish = writing.capability.publish;
  if (publish === "unsupported") throw new AgentToolError("CAPABILITY_UNSUPPORTED", `Surface ${writing.surface} is unsupported`);
  if (publish === "direct" || publish === "beta") {
    if (!writing.targetId) throw new AgentToolError("TARGET_REQUIRED", "A platform target is required");
    const target = resolveTargetById(writing.targetId);
    if (!target || target.status !== "active" || target.platform !== writing.platform) throw new AgentToolError("TARGET_REQUIRED", "A resolvable matching platform target is required");
  }
  const edge = findMaterializedEdge(variant.id);
  const anchored = variant.contentItemId ? db.select().from(contentItems).where(eq(contentItems.id, variant.contentItemId)).get() : undefined;
  const edgeItem = edge ? db.select().from(contentItems).where(eq(contentItems.id, edge.dstId)).get() : undefined;
  const adoption = !anchored && !edgeItem ? findAdoption(variant.id, writing.platform) : undefined;
  const existing = anchored ?? edgeItem ?? adoption;
  const fullyAnchored = Boolean(anchored && edge && edge.dstId === anchored.id);
  if (existing && fullyAnchored && snapshotMatches(existing, writing, approval)) {
    return { contentItemId: existing.id, created: false, updated: false, adopted: false, nextAction: publish === "direct" || publish === "beta" ? "publish" as const : "export" as const, capability: writing.capability };
  }
  if (existing && LANE.has(existing.status)) throw new AgentToolError("CONFLICT", `Cannot revise a ${existing.status} content item`);
  const linkedElsewhere = existing ? db.select().from(variants).where(and(eq(variants.contentItemId, existing.id), ne(variants.id, variant.id))).get() : undefined;
  if (linkedElsewhere) throw new AgentToolError("CONFLICT", "Content item is already linked to another variant", { reason: "content_item_already_linked" });
  return db.transaction(() => {
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
      materialization: { auditId: writing.audit!.id, inputHash: writing.audit!.inputHash, approvalAt: approval.at!, approvalBy: approval.by! },
      origin: priorWriting?.origin ?? { launchId: variant.launchId, variantId: variant.id },
      ...(priorWriting?.idempotencyKey ? { idempotencyKey: priorWriting.idempotencyKey } : {}),
    };
    const platformData = mergeContentWriting(existing?.platformData ?? {}, snapshot);
    const values = { title: variant.label, body: writing.units.texts[0], contentType: (writing.surface.endsWith("/thread") ? "thread" : "post") as "thread" | "post", platformTarget: writing.platform, status: "approved" as const, aiGenerated: true, generationPrompt: null, origin: "authored" as const, direction: "outbound" as const, platformData, updatedAt: now };
    if (existing) db.update(contentItems).set(values).where(eq(contentItems.id, contentItemId)).run();
    else db.insert(contentItems).values({ id: contentItemId, ...values, createdAt: now }).run();
    replaceMedia(contentItemId, writing.media?.assetIds ?? []);
    const storedWriting = { ...writing, approval, materializedContentItemId: contentItemId };
    db.update(variants).set({ contentItemId, status: "selected", metadata: JSON.stringify({ ...object(variant.metadata), writing: storedWriting }), updatedAt: now }).where(eq(variants.id, variant.id)).run();
    if (edge) {
      db.update(graphEdges).set({ dstId: contentItemId, properties: JSON.stringify({ platform: writing.platform, ...(writing.targetId ? { targetId: writing.targetId } : {}), approvalAt: approval.at, by: approval.by }), scope: launch.scope, source: "signals-writing", lastSeenAt: now, updatedAt: now }).where(eq(graphEdges.id, edge.id)).run();
    } else {
      db.insert(graphEdges).values({ id: nanoid(), srcType: "variant", srcId: variant.id, dstType: "content", dstId: contentItemId, edgeType: "materialized_as", properties: JSON.stringify({ platform: writing.platform, ...(writing.targetId ? { targetId: writing.targetId } : {}), approvalAt: approval.at, by: approval.by }), scope: launch.scope, source: "signals-writing", firstSeenAt: now, lastSeenAt: now }).run();
    }
    return {
      contentItemId,
      created: !existing,
      updated: Boolean(existing),
      adopted: Boolean(adoption),
      nextAction: publish === "direct" || publish === "beta" ? "publish" as const : "export" as const,
      capability: writing.capability,
    };
  });
}
