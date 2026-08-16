import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, sqlite } from "@/lib/db/client";
import {
  assertEmbeddingKind,
  assertEmbeddingNodeType,
  EMBEDDING_KIND_NODE_TYPES,
  type EmbeddingKind,
  V1_EMBEDDING_KINDS,
} from "@/lib/db/embedding-kinds";
import { contacts, contentItems, embeddings, launches, niches, orgs, variants } from "@/lib/db/schema";
import { nodeExists } from "@/lib/db/queries/graph";
import { resolveContactCareerSummary } from "@/lib/db/queries/contact-employments";
import { getActivePersona } from "@/lib/db/queries/personas";
import type { GraphNodeType } from "@/lib/db/types";
import {
  bufferToFloat32,
  cosineSimilarityWithQueryNormFromBuffer,
  finalizeSemanticTopK,
  float32ToBuffer,
  pushSemanticTopK,
  vectorL2Norm,
} from "@/lib/embeddings/vector-utils";
import { assertSharedEmbeddingSource } from "@/lib/embeddings/source-scope";

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

function resolveSearchNodeTypes(
  kind: EmbeddingKind,
  nodeTypes?: GraphNodeType[],
): GraphNodeType[] {
  if (!V1_EMBEDDING_KINDS.includes(kind as (typeof V1_EMBEDDING_KINDS)[number])) {
    return [];
  }
  const allowed = [...EMBEDDING_KIND_NODE_TYPES[kind]];
  if (!nodeTypes?.length) return allowed;

  const seen = new Set<GraphNodeType>();
  const resolved: GraphNodeType[] = [];
  for (const nodeType of nodeTypes) {
    if (!allowed.includes(nodeType) || seen.has(nodeType)) continue;
    seen.add(nodeType);
    resolved.push(nodeType);
  }
  return resolved;
}

type SearchableEmbeddingRow = {
  nodeType: GraphNodeType;
  nodeId: string;
  vector: Buffer;
};

const EMBEDDING_MATCH_WHERE =
  "e.kind = ? AND e.model = ? AND e.dims = ? AND e.node_type = ?";
const SHARED_EMBEDDING_SCOPE = " AND e.scope = 'shared'";
const preparedRawEmbeddingScanStatements = new Map<
  string,
  ReturnType<ReturnType<typeof sqlite.prepare>["raw"]>
>();
let embeddingNodeTypeExistsStmt: ReturnType<typeof sqlite.prepare> | null = null;

function getEmbeddingNodeTypeExistsStmt(): ReturnType<typeof sqlite.prepare> {
  if (!embeddingNodeTypeExistsStmt) {
    embeddingNodeTypeExistsStmt = sqlite.prepare(
      `SELECT 1 AS ok FROM embeddings
       WHERE kind = ? AND model = ? AND dims = ? AND node_type = ?
       AND (? = 1 OR scope = 'shared')
       LIMIT 1`,
    );
  }
  return embeddingNodeTypeExistsStmt;
}

function hasEmbeddingsForNodeType(
  kind: EmbeddingKind,
  model: string,
  queryDims: number,
  nodeType: GraphNodeType,
  includeLocalOnly?: boolean,
): boolean {
  return (
    getEmbeddingNodeTypeExistsStmt().get([
      kind,
      model,
      queryDims,
      nodeType,
      includeLocalOnly ? 1 : 0,
    ]) !== undefined
  );
}

function scanSqlEmbeddingRows(
  nodeType: GraphNodeType,
  sql: string,
  params: Array<string | number>,
  onRow: (row: SearchableEmbeddingRow) => void,
): void {
  let stmt = preparedRawEmbeddingScanStatements.get(sql);
  if (!stmt) {
    stmt = sqlite.prepare(sql).raw();
    preparedRawEmbeddingScanStatements.set(sql, stmt);
  }
  const rows = stmt.all(params) as Array<[string, Buffer]>;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    onRow({ nodeType, nodeId: row[0], vector: row[1] });
  }
}

function embeddingScanParams(
  input: SemanticSearchInput,
  queryDims: number,
  nodeType: GraphNodeType,
): Array<string | number> {
  return [input.kind, input.model, queryDims, nodeType];
}

function scanEmbeddingsForNodeType(
  input: SemanticSearchInput,
  queryDims: number,
  nodeType: GraphNodeType,
  onRow: (row: SearchableEmbeddingRow) => void,
): void {
  const params = embeddingScanParams(input, queryDims, nodeType);
  const sharedScope = input.includeLocalOnly ? "" : SHARED_EMBEDDING_SCOPE;

  switch (input.kind) {
    case "profile": {
      if (nodeType === "contact") {
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN contacts c ON c.id = e.node_id
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
        return;
      }
      if (nodeType === "org") {
        const liveScope = input.includeLocalOnly ? "" : " AND o.scope = 'shared'";
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN orgs o ON o.id = e.node_id${liveScope}
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
      }
      return;
    }
    case "description": {
      if (nodeType === "niche") {
        const liveScope = input.includeLocalOnly ? "" : " AND n.scope = 'shared'";
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN niches n ON n.id = e.node_id${liveScope}
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
        return;
      }
      if (nodeType === "launch") {
        const liveScope = input.includeLocalOnly ? "" : " AND l.scope = 'shared'";
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN launches l ON l.id = e.node_id${liveScope}
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
      }
      return;
    }
    case "body": {
      if (nodeType === "content") {
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN content_items ci ON ci.id = e.node_id
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
        return;
      }
      if (nodeType === "variant") {
        const liveScope = input.includeLocalOnly ? "" : " AND l.scope = 'shared'";
        scanSqlEmbeddingRows(
          nodeType,
          `SELECT e.node_id, e.vector
           FROM embeddings e
           INNER JOIN variants v ON v.id = e.node_id
           INNER JOIN launches l ON l.id = v.launch_id${liveScope}
           WHERE ${EMBEDDING_MATCH_WHERE}${sharedScope}`,
          params,
          onRow,
        );
      }
      return;
    }
    default:
      return;
  }
}

function scanSearchableEmbeddingRows(
  input: SemanticSearchInput,
  queryDims: number,
  onRow: (row: SearchableEmbeddingRow) => void,
): void {
  for (const nodeType of resolveSearchNodeTypes(input.kind, input.nodeTypes)) {
    if (
      !hasEmbeddingsForNodeType(
        input.kind,
        input.model,
        queryDims,
        nodeType,
        input.includeLocalOnly,
      )
    ) {
      continue;
    }
    scanEmbeddingsForNodeType(input, queryDims, nodeType, onRow);
  }
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
  const queryNorm = vectorL2Norm(input.queryVector);
  const invQueryNorm = queryNorm === 0 ? 0 : 1 / queryNorm;
  const top: SemanticSearchHit[] = [];

  scanSearchableEmbeddingRows(input, queryDims, (row) => {
    const score = cosineSimilarityWithQueryNormFromBuffer(
      input.queryVector,
      row.vector,
      invQueryNorm,
    );
    if (Number.isNaN(score)) return;
    if (top.length >= k && score <= top[0]!.score) return;
    pushSemanticTopK(top, { nodeType: row.nodeType, nodeId: row.nodeId, score }, k);
  });

  return finalizeSemanticTopK(top);
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
    const persona = getActivePersona(nodeId, { includeLocalOnly: true });
    if (!persona) throw new Error(`No active persona for contact: ${nodeId}`);
    const interests = JSON.parse(persona.interests ?? "[]") as string[];
    const conversionTriggers = JSON.parse(persona.conversionTriggers ?? "[]") as string[];
    const engagementFormats = JSON.parse(persona.engagementFormats ?? "[]") as string[];
    return joinText([
      persona.archetype ? `Archetype: ${persona.archetype}` : null,
      persona.tone ? `Tone: ${persona.tone}` : null,
      persona.summary ? `Summary: ${persona.summary}` : null,
      interests.length > 0 ? `Interests: ${interests.join(", ")}` : null,
      conversionTriggers.length > 0 ? `Converts on: ${conversionTriggers.join(", ")}` : null,
      engagementFormats.length > 0 ? `Engages with: ${engagementFormats.join(", ")}` : null,
    ]);
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
        const career = resolveContactCareerSummary(nodeId);
        return joinText([
          contact.name,
          contact.headline,
          career.company,
          career.title,
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

const CONTACT_PROFILE_EMBED_SWEEP_KEY = "contact-profile-employment-text-v1";

function ensureBackfillMarkersTable(): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _backfill_markers (key TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
}

function backfillMarkerApplied(key: string): boolean {
  ensureBackfillMarkersTable();
  return sqlite.prepare("SELECT 1 FROM _backfill_markers WHERE key = ?").get(key) !== undefined;
}

function markBackfillApplied(key: string): void {
  ensureBackfillMarkersTable();
  sqlite
    .prepare("INSERT OR IGNORE INTO _backfill_markers (key, applied_at) VALUES (?, ?)")
    .run(key, nowUnix());
}

/** One-time invalidation so contact profile embeddings use employment-backed text. */
export function sweepContactProfileEmbeddingsAfterEmploymentMigration(): {
  deleted: number;
  skipped: boolean;
} {
  if (backfillMarkerApplied(CONTACT_PROFILE_EMBED_SWEEP_KEY)) {
    return { deleted: 0, skipped: true };
  }

  const result = db
    .delete(embeddings)
    .where(and(eq(embeddings.nodeType, "contact"), eq(embeddings.kind, "profile")))
    .run();

  markBackfillApplied(CONTACT_PROFILE_EMBED_SWEEP_KEY);
  return { deleted: result.changes ?? 0, skipped: false };
}
