import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { contentItems, contentPosts, graphEdges, launches, variants } from "@/lib/db/schema";
import { queryGraphEdges } from "@/lib/db/queries/graph";
import type { EvidenceSpine, VariantGeneration, VariantWriting } from "@/lib/writing/contracts";
import { launchWritingSchema, variantWritingSchema } from "@/lib/writing/contracts";

const VARIANT_LINEAGE_EDGES = ["sourced_from", "derived_from", "adapted_from"] as const;
export const SIGNALS_OWNED_EDGE_TYPES = [...VARIANT_LINEAGE_EDGES, "materialized_as", "published_as"] as const;

export type LineageEdgeSummary = {
  edgeType: string;
  srcType: string;
  srcId: string;
  dstType: string;
  dstId: string;
};

function insertEdge(runner: DbRunner, input: {
  variantId: string;
  dstType: "variant" | "content";
  dstId: string;
  edgeType: string;
  properties: Record<string, unknown>;
  scope: "shared" | "local_only";
}): LineageEdgeSummary {
  const now = Math.floor(Date.now() / 1000);
  runner.insert(graphEdges).values({
    id: nanoid(), srcType: "variant", srcId: input.variantId, dstType: input.dstType,
    dstId: input.dstId, edgeType: input.edgeType, properties: JSON.stringify(input.properties),
    scope: input.scope, source: "signals-writing", firstSeenAt: now, lastSeenAt: now,
  }).run();
  return { edgeType: input.edgeType, srcType: "variant", srcId: input.variantId, dstType: input.dstType, dstId: input.dstId };
}

export function syncVariantLineageEdges(input: {
  variantId: string;
  writing: VariantWriting;
  generation: VariantGeneration;
  spine: EvidenceSpine;
  scope: "shared" | "local_only";
  runner?: DbRunner;
}): LineageEdgeSummary[] {
  const runner = input.runner ?? db;
  runner.delete(graphEdges).where(and(
    eq(graphEdges.srcType, "variant"),
    eq(graphEdges.srcId, input.variantId),
    inArray(graphEdges.edgeType, [...VARIANT_LINEAGE_EDGES]),
  )).run();
  const result: LineageEdgeSummary[] = [];
  const sources = new Map(input.spine.sources.map((source) => [source.id, source]));
  for (const sourceId of input.writing.lineage.sourceIds) {
    const source = sources.get(sourceId);
    if (source?.kind === "content_item") result.push(insertEdge(runner, { variantId: input.variantId, dstType: "content", dstId: source.contentItemId, edgeType: "sourced_from", properties: { sourceId, spineId: input.spine.id }, scope: input.scope }));
  }
  if (input.writing.lineage.derivedFromVariantId) result.push(insertEdge(runner, { variantId: input.variantId, dstType: "variant", dstId: input.writing.lineage.derivedFromVariantId, edgeType: "derived_from", properties: { spineId: input.spine.id, mode: input.generation.mode }, scope: input.scope }));
  if (input.writing.lineage.adaptedFromContentItemId) result.push(insertEdge(runner, { variantId: input.variantId, dstType: "content", dstId: input.writing.lineage.adaptedFromContentItemId, edgeType: "adapted_from", properties: { mode: "adapt" }, scope: input.scope }));
  if (input.writing.lineage.adaptedFromVariantId) result.push(insertEdge(runner, { variantId: input.variantId, dstType: "variant", dstId: input.writing.lineage.adaptedFromVariantId, edgeType: "adapted_from", properties: { mode: "adapt" }, scope: input.scope }));
  return result;
}

export function resolveWritingLineage(input: { contentPostId?: string; contentItemId?: string; variantId?: string }) {
  const post = input.contentPostId
    ? db.select().from(contentPosts).where(eq(contentPosts.id, input.contentPostId)).get()
    : undefined;
  const requestedContentItemId = input.contentItemId ?? post?.contentItemId;
  const anchoredVariant = requestedContentItemId
    ? db.select().from(variants).where(eq(variants.contentItemId, requestedContentItemId)).get()
    : undefined;
  const edge = requestedContentItemId
    ? db.select().from(graphEdges).where(and(eq(graphEdges.srcType, "variant"), eq(graphEdges.dstType, "content"), eq(graphEdges.dstId, requestedContentItemId), inArray(graphEdges.edgeType, ["materialized_as", "published_as"]))).get()
    : undefined;
  const variantId = input.variantId ?? anchoredVariant?.id ?? edge?.srcId;
  const variant = variantId ? db.select().from(variants).where(eq(variants.id, variantId)).get() : undefined;
  const contentItemId = requestedContentItemId ?? variant?.contentItemId ?? undefined;
  const launch = variant ? db.select().from(launches).where(eq(launches.id, variant.launchId)).get() : undefined;
  const edges = variantId
    ? queryGraphEdges({
        srcType: "variant",
        srcId: variantId,
        edgeTypes: ["sourced_from", "derived_from", "adapted_from", "materialized_as", "published_as"],
        includeLocalOnly: true,
      })
    : [];
  const parseObject = (value: unknown): Record<string, unknown> => {
    if (typeof value === "string") {
      try { return parseObject(JSON.parse(value)); } catch { return {}; }
    }
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  };
  const launchWriting = launchWritingSchema.safeParse(parseObject(launch?.metadata).writing);
  const variantWriting = variantWritingSchema.safeParse(parseObject(variant?.metadata).writing);
  const usedSourceIds = new Set(variantWriting.success ? variantWriting.data.lineage.sourceIds : []);
  const sources = launchWriting.success && launchWriting.data.spine
    ? launchWriting.data.spine.sources
        .filter((source) => usedSourceIds.has(source.id))
        .map((source) => ({
          id: source.id,
          kind: source.kind,
          ...(source.kind === "content_item" ? { contentItemId: source.contentItemId } : {}),
        }))
    : [];
  const materializationEdge = edges.find((candidate) => candidate.edgeType === "materialized_as");
  const publishedEdge = edges.find((candidate) => candidate.edgeType === "published_as");
  const publishedProperties = publishedEdge ? parseObject(publishedEdge.properties) : {};
  return {
    ...(post ? { post } : {}),
    ...(contentItemId ? { contentItem: db.select().from(contentItems).where(eq(contentItems.id, contentItemId)).get() ?? null } : {}),
    variant: variant ?? null,
    launch: launch ?? null,
    edges,
    sources,
    ...(materializationEdge ? { materialization: materializationEdge } : {}),
    ...(publishedEdge
      ? {
          published: {
            ...(typeof publishedProperties.targetId === "string" ? { targetId: publishedProperties.targetId } : {}),
            ...(typeof publishedProperties.published_at === "number"
              ? { publishedAt: publishedProperties.published_at }
              : {}),
          },
        }
      : {}),
  };
}
