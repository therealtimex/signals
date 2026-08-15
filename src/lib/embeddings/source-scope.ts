import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assertEmbeddingKind,
  assertEmbeddingNodeType,
  type EmbeddingKind,
} from "@/lib/db/embedding-kinds";
import { contacts, contentItems, launches, niches, orgs, variants } from "@/lib/db/schema";
import { nodeExists } from "@/lib/db/queries/graph";
import type { GraphNodeType } from "@/lib/db/types";

export type EmbeddingSourceScope = "shared" | "local_only";

const IN_CHUNK_SIZE = 900;

function visibilityKey(nodeType: GraphNodeType, nodeId: string): string {
  return `${nodeType}:${nodeId}`;
}

function selectContactIdsInChunks(ids: string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const rows = db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, chunk)).all();
    for (const row of rows) found.add(row.id);
  }
  return found;
}

function selectContentIdsInChunks(ids: string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const rows = db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(inArray(contentItems.id, chunk))
      .all();
    for (const row of rows) found.add(row.id);
  }
  return found;
}

function selectOrgScopesInChunks(ids: string[]): Map<string, EmbeddingSourceScope> {
  const found = new Map<string, EmbeddingSourceScope>();
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const rows = db
      .select({ id: orgs.id, scope: orgs.scope })
      .from(orgs)
      .where(inArray(orgs.id, chunk))
      .all();
    for (const row of rows) found.set(row.id, row.scope);
  }
  return found;
}

function selectNicheScopesInChunks(ids: string[]): Map<string, EmbeddingSourceScope> {
  const found = new Map<string, EmbeddingSourceScope>();
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const rows = db
      .select({ id: niches.id, scope: niches.scope })
      .from(niches)
      .where(inArray(niches.id, chunk))
      .all();
    for (const row of rows) found.set(row.id, row.scope);
  }
  return found;
}

function selectLaunchScopesInChunks(ids: string[]): Map<string, EmbeddingSourceScope> {
  const found = new Map<string, EmbeddingSourceScope>();
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const rows = db
      .select({ id: launches.id, scope: launches.scope })
      .from(launches)
      .where(inArray(launches.id, chunk))
      .all();
    for (const row of rows) found.set(row.id, row.scope);
  }
  return found;
}

/** Batch-resolve which embedding rows are visible under current source scope. */
export function buildEmbeddingSourceVisibilityLookup(
  kind: EmbeddingKind,
  entries: Array<{ nodeType: GraphNodeType; nodeId: string }>,
  includeLocalOnly?: boolean,
): Map<string, boolean> {
  const lookup = new Map<string, boolean>();
  const idsByType = new Map<GraphNodeType, Set<string>>();

  for (const entry of entries) {
    const ids = idsByType.get(entry.nodeType) ?? new Set<string>();
    ids.add(entry.nodeId);
    idsByType.set(entry.nodeType, ids);
  }

  const markScoped = (nodeType: GraphNodeType, scopeById: Map<string, EmbeddingSourceScope>) => {
    const ids = idsByType.get(nodeType);
    if (!ids) return;
    for (const nodeId of ids) {
      const scope = scopeById.get(nodeId);
      lookup.set(
        visibilityKey(nodeType, nodeId),
        scope !== undefined && (includeLocalOnly || scope === "shared"),
      );
    }
  };

  const markExisting = (nodeType: GraphNodeType, existingIds: Set<string>) => {
    const ids = idsByType.get(nodeType);
    if (!ids) return;
    for (const nodeId of ids) {
      lookup.set(visibilityKey(nodeType, nodeId), existingIds.has(nodeId));
    }
  };

  switch (kind) {
    case "profile": {
      const contactIds = [...(idsByType.get("contact") ?? [])];
      if (contactIds.length) {
        markExisting("contact", selectContactIdsInChunks(contactIds));
      }
      markScoped("org", selectOrgScopesInChunks([...(idsByType.get("org") ?? [])]));
      break;
    }
    case "description": {
      markScoped("niche", selectNicheScopesInChunks([...(idsByType.get("niche") ?? [])]));
      markScoped("launch", selectLaunchScopesInChunks([...(idsByType.get("launch") ?? [])]));
      break;
    }
    case "body": {
      const contentIds = [...(idsByType.get("content") ?? [])];
      if (contentIds.length) {
        markExisting("content", selectContentIdsInChunks(contentIds));
      }
      const variantIds = [...(idsByType.get("variant") ?? [])];
      for (let i = 0; i < variantIds.length; i += IN_CHUNK_SIZE) {
        const chunk = variantIds.slice(i, i + IN_CHUNK_SIZE);
        const rows = db
          .select({ id: variants.id, scope: launches.scope })
          .from(variants)
          .innerJoin(launches, eq(variants.launchId, launches.id))
          .where(inArray(variants.id, chunk))
          .all();
        for (const row of rows) {
          lookup.set(
            visibilityKey("variant", row.id),
            includeLocalOnly || row.scope === "shared",
          );
        }
      }
      break;
    }
    default:
      break;
  }

  return lookup;
}

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
