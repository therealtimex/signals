import { and, desc, eq, inArray, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  assertEmbeddingKind,
  assertEmbeddingNodeType,
  type EmbeddingKind,
} from "@/lib/db/embedding-kinds";
import { contacts, contentItems, embeddings, launches, niches, orgs, variants } from "@/lib/db/schema";
import { nodeExists } from "@/lib/db/queries/graph";
import type { GraphNodeType } from "@/lib/db/types";
import {
  bufferToFloat32,
  cosineSimilarityWithQueryNorm,
  float32ToBuffer,
  topKSemanticHits,
  vectorL2Norm,
} from "@/lib/embeddings/vector-utils";
import { assertSharedEmbeddingSource, buildEmbeddingSourceVisibilityLookup } from "@/lib/embeddings/source-scope";

export type EmbeddingRow = typeof embeddings.$inferSelect;

export type UpsertEmbeddingInput = {
  nodeType: GraphNodeType;
  nodeId: string;
  kind: EmbeddingKind;
  model: string;
  vector: Float32Array | Buffer;
  contentHash: string;
  dims: number;
  scope?: "shared" | "local_only";
  force?: boolean;
};

export type SemanticSearchInput = {
  nodeTypes?: GraphNodeType[];
  kind: EmbeddingKind;
  model: string;
  queryVector: Float32Array;
  k?: number;
  includeLocalOnly?: boolean;
};

export type SemanticSearchHit = {
  nodeType: GraphNodeType;
  nodeId: string;
  score: number;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function scopeCondition(includeLocalOnly?: boolean): SQL | undefined {
  if (includeLocalOnly) return undefined;
  return eq(embeddings.scope, "shared");
}

function normalizeVector(vector: Float32Array | Buffer): Buffer {
  return Buffer.isBuffer(vector) ? vector : float32ToBuffer(vector);
}

export function getLatestEmbedding(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
): EmbeddingRow | null {
  return (
    db
      .select()
      .from(embeddings)
      .where(
        and(
          eq(embeddings.nodeType, nodeType),
          eq(embeddings.nodeId, nodeId),
          eq(embeddings.kind, kind),
        ),
      )
      .orderBy(desc(embeddings.updatedAt))
      .limit(1)
      .get() ?? null
  );
}

/** Insert or update an embedding row; no-op when content hash is unchanged. */
export function upsertEmbedding(input: UpsertEmbeddingInput): EmbeddingRow | null {
  assertEmbeddingKind(input.kind);
  assertEmbeddingNodeType(input.kind, input.nodeType);

  if (!nodeExists(input.nodeType, input.nodeId)) {
    throw new Error(`Embedding target not found: ${input.nodeType}:${input.nodeId}`);
  }

  const vectorBuffer = normalizeVector(input.vector);
  const parsed = bufferToFloat32(vectorBuffer);
  if (parsed.length !== input.dims) {
    throw new Error(`Embedding dims mismatch: expected ${input.dims}, got ${parsed.length}`);
  }

  const existing = db
    .select()
    .from(embeddings)
    .where(
      and(
        eq(embeddings.nodeType, input.nodeType),
        eq(embeddings.nodeId, input.nodeId),
        eq(embeddings.kind, input.kind),
        eq(embeddings.model, input.model),
      ),
    )
    .get();

  if (existing?.contentHash === input.contentHash && !input.force) {
    return existing;
  }

  const now = nowUnix();
  const scope = input.scope ?? "shared";

  if (existing) {
    db.update(embeddings)
      .set({
        dims: input.dims,
        vector: vectorBuffer,
        contentHash: input.contentHash,
        scope,
        updatedAt: now,
      })
      .where(eq(embeddings.id, existing.id))
      .run();
    return db.select().from(embeddings).where(eq(embeddings.id, existing.id)).get()!;
  }

  const id = nanoid();
  db.insert(embeddings)
    .values({
      id,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      kind: input.kind,
      model: input.model,
      dims: input.dims,
      vector: vectorBuffer,
      contentHash: input.contentHash,
      scope,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(embeddings).where(eq(embeddings.id, id)).get()!;
}

/** Brute-force cosine search over stored embeddings (ADR-022-4). */
export function semanticSearch(input: SemanticSearchInput): SemanticSearchHit[] {
  assertEmbeddingKind(input.kind);

  const k = input.k ?? 10;
  const queryDims = input.queryVector.length;
  const conditions: SQL[] = [
    eq(embeddings.kind, input.kind),
    eq(embeddings.model, input.model),
    eq(embeddings.dims, queryDims),
  ];

  const scope = scopeCondition(input.includeLocalOnly);
  if (scope) conditions.push(scope);

  if (input.nodeTypes?.length) {
    conditions.push(inArray(embeddings.nodeType, input.nodeTypes));
  }

  const rows = db
    .select({
      nodeType: embeddings.nodeType,
      nodeId: embeddings.nodeId,
      vector: embeddings.vector,
    })
    .from(embeddings)
    .where(and(...conditions))
    .all();

  const visibility = buildEmbeddingSourceVisibilityLookup(
    input.kind,
    rows.map((row) => ({ nodeType: row.nodeType as GraphNodeType, nodeId: row.nodeId })),
    input.includeLocalOnly,
  );

  const queryNorm = vectorL2Norm(input.queryVector);
  const hits: SemanticSearchHit[] = [];
  for (const row of rows) {
    const nodeType = row.nodeType as GraphNodeType;
    if (!visibility.get(`${nodeType}:${row.nodeId}`)) {
      continue;
    }

    const vector = bufferToFloat32(row.vector);
    if (vector.length !== queryDims) continue;
    hits.push({
      nodeType,
      nodeId: row.nodeId,
      score: cosineSimilarityWithQueryNorm(input.queryVector, vector, queryNorm),
    });
  }

  return topKSemanticHits(hits, k);
}

function joinText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

/** Assemble embeddable text from shared-scope node fields (v1). */
export function assembleEmbedText(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
): string {
  assertEmbeddingKind(kind);
  assertEmbeddingNodeType(kind, nodeType);
  assertSharedEmbeddingSource(nodeType, nodeId, kind);

  if (kind === "persona") {
    throw new Error('Embedding kind "persona" is reserved for a follow-on epic.');
  }

  switch (kind) {
    case "description": {
      if (nodeType === "niche") {
        const niche = db.select().from(niches).where(eq(niches.id, nodeId)).get();
        if (!niche) throw new Error(`Niche not found: ${nodeId}`);
        return joinText([niche.name, niche.description]);
      }
      const launch = db.select().from(launches).where(eq(launches.id, nodeId)).get();
      if (!launch) throw new Error(`Launch not found: ${nodeId}`);
      return joinText([launch.name, launch.brief]);
    }
    case "body": {
      if (nodeType === "content") {
        const content = db.select().from(contentItems).where(eq(contentItems.id, nodeId)).get();
        if (!content) throw new Error(`Content item not found: ${nodeId}`);
        return joinText([content.title, content.body]);
      }
      const variant = db.select().from(variants).where(eq(variants.id, nodeId)).get();
      if (!variant) throw new Error(`Variant not found: ${nodeId}`);
      return joinText([variant.label, variant.body]);
    }
    case "profile": {
      if (nodeType === "contact") {
        const contact = db.select().from(contacts).where(eq(contacts.id, nodeId)).get();
        if (!contact) throw new Error(`Contact not found: ${nodeId}`);
        return joinText([
          contact.name,
          contact.headline,
          contact.company,
          contact.title,
          contact.bio,
          contact.location,
        ]);
      }
      const org = db.select().from(orgs).where(eq(orgs.id, nodeId)).get();
      if (!org) throw new Error(`Org not found: ${nodeId}`);
      return joinText([org.name, org.description, org.domain, org.location]);
    }
    default:
      throw new Error(`Unsupported embedding kind: ${kind satisfies never}`);
  }
}
