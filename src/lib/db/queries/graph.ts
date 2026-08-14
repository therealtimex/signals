import { and, eq, or, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contacts,
  contentItems,
  contactIdentities,
  goals,
  graphEdges,
  interactions,
  niches,
  orgs,
  workflowRuns,
} from "@/lib/db/schema";
import type { GraphEdge, GraphNodeType } from "@/lib/db/types";

const LOCAL_ONLY_EDGE_TYPES = new Set(["relationship"]);

export type SerializedGraphEdge = Omit<GraphEdge, "propertiesPrivate"> & {
  propertiesPrivate?: string | null;
};

export type UpsertGraphEdgeInput = {
  srcType: GraphNodeType;
  srcId: string;
  dstType: GraphNodeType;
  dstId: string;
  edgeType: string;
  weight?: number | null;
  properties?: string | null;
  propertiesPrivate?: string | null;
  scope?: "shared" | "local_only";
  source?: string | null;
};

export type GraphQueryOptions = {
  includeLocalOnly?: boolean;
  edgeTypes?: string[];
  direction?: "outgoing" | "incoming" | "both";
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Conservative default scope by edge type (ADR-022-2). */
export function defaultScopeForEdgeType(edgeType: string): "shared" | "local_only" {
  return LOCAL_ONLY_EDGE_TYPES.has(edgeType) ? "local_only" : "shared";
}

/** Strip private fields unless explicitly requested. */
export function serializeGraphEdge(
  edge: GraphEdge,
  opts?: { includeLocalOnly?: boolean },
): SerializedGraphEdge {
  const { propertiesPrivate, ...rest } = edge;
  if (opts?.includeLocalOnly) {
    return { ...rest, propertiesPrivate };
  }
  return rest;
}

function scopeCondition(includeLocalOnly?: boolean): SQL | undefined {
  if (includeLocalOnly) return undefined;
  return eq(graphEdges.scope, "shared");
}

function nodeTable(type: GraphNodeType) {
  switch (type) {
    case "contact":
      return contacts;
    case "org":
      return orgs;
    case "niche":
      return niches;
    case "content":
      return contentItems;
    case "goal":
      return goals;
    case "workflow_run":
      return workflowRuns;
    case "platform_identity":
      return contactIdentities;
    case "interaction":
      return interactions;
    default:
      return null;
  }
}

/** Validate polymorphic edge endpoints exist in their typed tables. */
export function nodeExists(type: GraphNodeType, id: string): boolean {
  const table = nodeTable(type);
  if (!table) return false;
  const row = db.select({ id: table.id }).from(table).where(eq(table.id, id)).get();
  return Boolean(row);
}

export function validateEdgeEndpoints(
  srcType: GraphNodeType,
  srcId: string,
  dstType: GraphNodeType,
  dstId: string,
): void {
  if (!nodeExists(srcType, srcId)) {
    throw new Error(`Graph edge source not found: ${srcType}:${srcId}`);
  }
  if (!nodeExists(dstType, dstId)) {
    throw new Error(`Graph edge destination not found: ${dstType}:${dstId}`);
  }
}

/** Upsert by natural key (edge_type + src + dst); bumps last_seen_at on conflict. */
export function upsertGraphEdge(input: UpsertGraphEdgeInput): GraphEdge {
  validateEdgeEndpoints(input.srcType, input.srcId, input.dstType, input.dstId);

  const scope = input.scope ?? defaultScopeForEdgeType(input.edgeType);
  const now = nowUnix();

  const existing = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, input.edgeType),
        eq(graphEdges.srcType, input.srcType),
        eq(graphEdges.srcId, input.srcId),
        eq(graphEdges.dstType, input.dstType),
        eq(graphEdges.dstId, input.dstId),
      ),
    )
    .get();

  if (existing) {
    db.update(graphEdges)
      .set({
        weight: input.weight ?? existing.weight,
        properties: input.properties ?? existing.properties,
        propertiesPrivate: input.propertiesPrivate ?? existing.propertiesPrivate,
        scope: input.scope ?? existing.scope,
        source: input.source ?? existing.source,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(graphEdges.id, existing.id))
      .run();
    return db.select().from(graphEdges).where(eq(graphEdges.id, existing.id)).get()!;
  }

  const id = nanoid();
  db.insert(graphEdges)
    .values({
      id,
      srcType: input.srcType,
      srcId: input.srcId,
      dstType: input.dstType,
      dstId: input.dstId,
      edgeType: input.edgeType,
      weight: input.weight ?? null,
      properties: input.properties ?? "{}",
      propertiesPrivate: input.propertiesPrivate ?? null,
      scope,
      source: input.source ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .run();

  return db.select().from(graphEdges).where(eq(graphEdges.id, id)).get()!;
}

/** Query edges touching a node (1-hop). */
export function getNeighbors(
  nodeType: GraphNodeType,
  nodeId: string,
  opts?: GraphQueryOptions,
): SerializedGraphEdge[] {
  const conditions: SQL[] = [];
  const scope = scopeCondition(opts?.includeLocalOnly);
  if (scope) conditions.push(scope);

  if (opts?.edgeTypes?.length) {
    const typeFilters = opts.edgeTypes.map((edgeType) => eq(graphEdges.edgeType, edgeType));
    conditions.push(or(...typeFilters)!);
  }

  const direction = opts?.direction ?? "both";
  const rows: GraphEdge[] = [];

  if (direction === "outgoing" || direction === "both") {
    rows.push(
      ...db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.srcType, nodeType),
            eq(graphEdges.srcId, nodeId),
            ...(conditions.length ? [and(...conditions)] : []),
          ),
        )
        .all(),
    );
  }

  if (direction === "incoming" || direction === "both") {
    rows.push(
      ...db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.dstType, nodeType),
            eq(graphEdges.dstId, nodeId),
            ...(conditions.length ? [and(...conditions)] : []),
          ),
        )
        .all(),
    );
  }

  const seen = new Set<string>();
  return rows
    .filter((edge) => {
      if (seen.has(edge.id)) return false;
      seen.add(edge.id);
      return true;
    })
    .map((edge) => serializeGraphEdge(edge, { includeLocalOnly: opts?.includeLocalOnly }));
}

/** Filter edges by endpoint and optional edge types with privacy defaults applied. */
export function queryGraphEdges(params: {
  srcType?: GraphNodeType;
  srcId?: string;
  dstType?: GraphNodeType;
  dstId?: string;
  edgeTypes?: string[];
  includeLocalOnly?: boolean;
}): SerializedGraphEdge[] {
  const conditions: SQL[] = [];
  const scope = scopeCondition(params.includeLocalOnly);
  if (scope) conditions.push(scope);

  if (params.srcType) conditions.push(eq(graphEdges.srcType, params.srcType));
  if (params.srcId) conditions.push(eq(graphEdges.srcId, params.srcId));
  if (params.dstType) conditions.push(eq(graphEdges.dstType, params.dstType));
  if (params.dstId) conditions.push(eq(graphEdges.dstId, params.dstId));

  if (params.edgeTypes?.length) {
    const typeFilters = params.edgeTypes.map((edgeType) => eq(graphEdges.edgeType, edgeType));
    conditions.push(or(...typeFilters)!);
  }

  const rows = db
    .select()
    .from(graphEdges)
    .where(conditions.length ? and(...conditions) : undefined)
    .all();

  return rows.map((edge) =>
    serializeGraphEdge(edge, { includeLocalOnly: params.includeLocalOnly }),
  );
}
