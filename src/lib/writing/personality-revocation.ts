import { and, eq } from "drizzle-orm";
import { db, type DbRunner } from "@/lib/db/client";
import { contentItems, graphEdges, variants } from "@/lib/db/schema";
import type { Variant } from "@/lib/db/types";
import {
  type ApprovalState,
  variantWritingSchema,
} from "@/lib/writing/contracts";
import type { TargetRepresentation } from "@/lib/writing/personality-lineage";

const PUBLISH_LANE_STATUSES = new Set(["queued", "publishing", "published", "scheduled"]);

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sameRepresentation(left: TargetRepresentation, right: TargetRepresentation): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "self" && right.kind === "self") return left.contactId === right.contactId;
  if (left.kind === "org" && right.kind === "org") return left.orgId === right.orgId;
  return left.kind === "unbound" && right.kind === "unbound";
}

export function revokeWritingVariantWithRunner(
  tx: DbRunner,
  input: {
    variant: Variant;
    reason: ApprovalState["revokedReason"];
    note?: string;
    allowQueuedNoop?: boolean;
    now?: number;
  },
): { blocked: boolean; mutated: boolean; contentItemId: string | null } {
  const parsed = variantWritingSchema.safeParse(object(input.variant.metadata).writing);
  if (!parsed.success) return { blocked: false, mutated: false, contentItemId: null };
  const edge = tx.select().from(graphEdges).where(and(
    eq(graphEdges.srcType, "variant"),
    eq(graphEdges.srcId, input.variant.id),
    eq(graphEdges.dstType, "content"),
    eq(graphEdges.edgeType, "materialized_as"),
  )).get();
  const contentItemId = input.variant.contentItemId ?? edge?.dstId ?? null;
  const item = contentItemId
    ? tx.select().from(contentItems).where(eq(contentItems.id, contentItemId)).get()
    : undefined;
  const inLane = Boolean(item && PUBLISH_LANE_STATUSES.has(item.status));
  if (inLane) {
    return {
      blocked: !input.allowQueuedNoop,
      mutated: false,
      contentItemId,
    };
  }
  const edgeProperties = object(edge?.properties);
  const alreadyReconciled = parsed.data.approval.state === "revoked"
    && parsed.data.approval.revokedReason === input.reason
    && (input.note === undefined || parsed.data.approval.note === input.note)
    && input.variant.status !== "selected"
    && item?.status !== "approved"
    && (!edge || (
      edgeProperties.revokedReason === input.reason
      && typeof edgeProperties.revokedAt === "number"
    ));
  if (alreadyReconciled) {
    return { blocked: false, mutated: false, contentItemId };
  }
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const writing = {
    ...parsed.data,
    approval: {
      ...parsed.data.approval,
      state: "revoked" as const,
      ...(input.reason === "user" ? { by: "user" as const } : {}),
      at: now,
      ...(parsed.data.audit ? { auditId: parsed.data.audit.id } : {}),
      revokedReason: input.reason,
      ...(input.note ? { note: input.note } : {}),
    },
  };
  tx.update(variants).set({
    metadata: JSON.stringify({ ...object(input.variant.metadata), writing }),
    ...(input.variant.status === "selected" ? { status: "draft" as const } : {}),
    updatedAt: now,
  }).where(eq(variants.id, input.variant.id)).run();
  if (item?.status === "approved") {
    tx.update(contentItems)
      .set({ status: "draft", updatedAt: now })
      .where(eq(contentItems.id, item.id))
      .run();
  }
  if (edge) {
    tx.update(graphEdges).set({
      properties: JSON.stringify({
        ...object(edge.properties),
        revokedAt: now,
        revokedReason: input.reason,
      }),
      updatedAt: now,
    }).where(eq(graphEdges.id, edge.id)).run();
  }
  return { blocked: false, mutated: true, contentItemId };
}

export function reconcilePersonalityBindingWithRunner(
  tx: DbRunner,
  bindingId: string | null,
): string[] {
  const revoked: string[] = [];
  for (const variant of tx.select().from(variants).all()) {
    const writing = variantWritingSchema.safeParse(object(variant.metadata).writing);
    if (!writing.success || !writing.data.personality) continue;
    if (bindingId !== null && writing.data.personality.bindingId === bindingId) continue;
    const result = revokeWritingVariantWithRunner(tx, {
      variant,
      reason: "personality_stale",
      allowQueuedNoop: true,
    });
    if (result.mutated) revoked.push(variant.id);
  }
  return revoked;
}

export function reconcilePersonalityBinding(bindingId: string | null): string[] {
  return db.transaction(
    (tx) => reconcilePersonalityBindingWithRunner(tx, bindingId),
    { behavior: "immediate" },
  );
}

export function revokeVariantsForTargetRepresentationWithRunner(
  tx: DbRunner,
  targetId: string,
  represents: TargetRepresentation,
): string[] {
  const revoked: string[] = [];
  for (const variant of tx.select().from(variants).all()) {
    const writing = variantWritingSchema.safeParse(object(variant.metadata).writing);
    const target = writing.success ? writing.data.personality?.target : null;
    if (!target || target.targetId !== targetId || sameRepresentation(target.represents, represents)) {
      continue;
    }
    const result = revokeWritingVariantWithRunner(tx, {
      variant,
      reason: "personality_stale",
      allowQueuedNoop: true,
    });
    if (result.mutated) revoked.push(variant.id);
  }
  return revoked;
}
