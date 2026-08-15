import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assertEmbeddingKind,
  assertEmbeddingNodeType,
  type EmbeddingKind,
} from "@/lib/db/embedding-kinds";
import { launches, niches, orgs, variants } from "@/lib/db/schema";
import { nodeExists } from "@/lib/db/queries/graph";
import type { GraphNodeType } from "@/lib/db/types";

export type EmbeddingSourceScope = "shared" | "local_only";

/** Resolve the current source scope that governs whether an embedding may be searched. */
export function resolveEmbeddingSourceScope(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
): EmbeddingSourceScope {
  assertEmbeddingKind(kind);
  assertEmbeddingNodeType(kind, nodeType);

  if (kind === "persona") {
    throw new Error('Embedding kind "persona" is reserved for a follow-on epic.');
  }

  switch (kind) {
    case "description": {
      if (nodeType === "niche") {
        const niche = db.select({ scope: niches.scope }).from(niches).where(eq(niches.id, nodeId)).get();
        if (!niche) throw new Error(`Niche not found: ${nodeId}`);
        return niche.scope;
      }
      const launch = db.select({ scope: launches.scope }).from(launches).where(eq(launches.id, nodeId)).get();
      if (!launch) throw new Error(`Launch not found: ${nodeId}`);
      return launch.scope;
    }
    case "body": {
      if (nodeType === "content") return "shared";
      const variant = db
        .select({ launchId: variants.launchId })
        .from(variants)
        .where(eq(variants.id, nodeId))
        .get();
      if (!variant) throw new Error(`Variant not found: ${nodeId}`);
      const launch = db
        .select({ scope: launches.scope })
        .from(launches)
        .where(eq(launches.id, variant.launchId))
        .get();
      if (!launch) throw new Error(`Launch not found: ${variant.launchId}`);
      return launch.scope;
    }
    case "profile": {
      if (nodeType === "contact") return "shared";
      const org = db.select({ scope: orgs.scope }).from(orgs).where(eq(orgs.id, nodeId)).get();
      if (!org) throw new Error(`Org not found: ${nodeId}`);
      return org.scope;
    }
    default:
      throw new Error(`Unsupported embedding kind: ${kind satisfies never}`);
  }
}

export function assertSharedEmbeddingSource(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
): void {
  const scope = resolveEmbeddingSourceScope(nodeType, nodeId, kind);
  if (scope === "local_only") {
    throw new Error(
      `Cannot assemble shared-scope embedding text for local_only ${nodeType}:${nodeId} in v1`,
    );
  }
}

export function isEmbeddingSourceVisible(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
  includeLocalOnly?: boolean,
): boolean {
  if (!nodeExists(nodeType, nodeId)) return false;
  if (includeLocalOnly) return true;
  return resolveEmbeddingSourceScope(nodeType, nodeId, kind) === "shared";
}
