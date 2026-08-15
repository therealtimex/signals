import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, embeddings, graphEdges, niches } from "@/lib/db/schema";
import { nodeExists } from "@/lib/db/queries/graph";
import type { GraphEdge, GraphNodeType } from "@/lib/db/types";

export type GraphIntegrityIssueReason =
  | "missing_endpoint"
  | "archived_contact"
  | "stale_niche_membership";

export type EmbeddingIntegrityIssueReason = "missing_endpoint";

export type GraphIntegrityIssue = {
  edgeId: string;
  edgeType: string;
  endpoint: "src" | "dst";
  nodeType: GraphNodeType;
  nodeId: string;
  reason: GraphIntegrityIssueReason;
};

export type EmbeddingIntegrityIssue = {
  embeddingId: string;
  nodeType: GraphNodeType;
  nodeId: string;
  kind: string;
  reason: EmbeddingIntegrityIssueReason;
};

export type GraphIntegrityReport = {
  scannedAt: number;
  totalEdges: number;
  totalEmbeddings: number;
  issueCount: number;
  repairedCount: number;
  issues: GraphIntegrityIssue[];
  embeddingIssues: EmbeddingIntegrityIssue[];
};

function isArchivedContact(contactId: string): boolean {
  const row = db
    .select({ metadata: contacts.metadata })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  if (!row) return false;
  try {
    const metadata = JSON.parse(row.metadata ?? "{}") as { archived?: number };
    return metadata.archived === 1;
  } catch {
    return false;
  }
}

function endpointIssue(
  edge: GraphEdge,
  endpoint: "src" | "dst",
): GraphIntegrityIssue | null {
  const nodeType = endpoint === "src" ? edge.srcType : edge.dstType;
  const nodeId = endpoint === "src" ? edge.srcId : edge.dstId;

  if (!nodeExists(nodeType, nodeId)) {
    return {
      edgeId: edge.id,
      edgeType: edge.edgeType,
      endpoint,
      nodeType,
      nodeId,
      reason: "missing_endpoint",
    };
  }

  if (nodeType === "contact" && isArchivedContact(nodeId)) {
    return {
      edgeId: edge.id,
      edgeType: edge.edgeType,
      endpoint,
      nodeType,
      nodeId,
      reason: "archived_contact",
    };
  }

  if (
    edge.edgeType === "belongs_to_niche" &&
    nodeType === "niche" &&
    endpoint === "dst"
  ) {
    const niche = db.select().from(niches).where(eq(niches.id, nodeId)).get();
    if (niche && (niche.status === "merged" || niche.status === "archived")) {
      return {
        edgeId: edge.id,
        edgeType: edge.edgeType,
        endpoint,
        nodeType,
        nodeId,
        reason: "stale_niche_membership",
      };
    }
  }

  return null;
}

/** Scan all graph edges for missing endpoints and archived contact references. */
export function auditGraphIntegrity(): GraphIntegrityReport {
  const edges = db.select().from(graphEdges).all();
  const issues: GraphIntegrityIssue[] = [];

  for (const edge of edges) {
    const srcIssue = endpointIssue(edge, "src");
    const dstIssue = endpointIssue(edge, "dst");
    if (srcIssue) issues.push(srcIssue);
    if (dstIssue) issues.push(dstIssue);
  }

  const embeddingRows = db.select().from(embeddings).all();
  const embeddingIssues: EmbeddingIntegrityIssue[] = [];
  for (const row of embeddingRows) {
    const nodeType = row.nodeType as GraphNodeType;
    if (!nodeExists(nodeType, row.nodeId)) {
      embeddingIssues.push({
        embeddingId: row.id,
        nodeType,
        nodeId: row.nodeId,
        kind: row.kind,
        reason: "missing_endpoint",
      });
    }
  }

  const uniqueEdgeIds = new Set(issues.map((issue) => issue.edgeId));
  const uniqueEmbeddingIds = new Set(embeddingIssues.map((issue) => issue.embeddingId));

  return {
    scannedAt: Math.floor(Date.now() / 1000),
    totalEdges: edges.length,
    totalEmbeddings: embeddingRows.length,
    issueCount: uniqueEdgeIds.size + uniqueEmbeddingIds.size,
    repairedCount: 0,
    issues,
    embeddingIssues,
  };
}

/** Delete edges touching a contact node (used when archiving). */
export function deleteEdgesTouchingContact(contactId: string): number {
  const edges = db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(
      or(
        and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, contactId)),
        and(eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, contactId)),
      ),
    )
    .all();

  for (const edge of edges) {
    db.delete(graphEdges).where(eq(graphEdges.id, edge.id)).run();
  }

  return edges.length;
}

/** Remove invalid edges and orphaned embeddings identified by the audit (idempotent). */
export function repairGraphIntegrity(report?: GraphIntegrityReport): GraphIntegrityReport {
  const audit = report ?? auditGraphIntegrity();
  const edgeIds = [...new Set(audit.issues.map((issue) => issue.edgeId))];
  const embeddingIds = [...new Set(audit.embeddingIssues.map((issue) => issue.embeddingId))];

  for (const edgeId of edgeIds) {
    db.delete(graphEdges).where(eq(graphEdges.id, edgeId)).run();
  }

  for (const embeddingId of embeddingIds) {
    db.delete(embeddings).where(eq(embeddings.id, embeddingId)).run();
  }

  return {
    ...audit,
    repairedCount: edgeIds.length + embeddingIds.length,
  };
}

/** Audit and optionally repair graph integrity. Safe to run on startup. */
export function runGraphIntegrityJob(opts?: { repair?: boolean }): GraphIntegrityReport {
  const audit = auditGraphIntegrity();
  if (!opts?.repair || audit.issueCount === 0) {
    return audit;
  }
  return repairGraphIntegrity(audit);
}

/** Summary for analytics / Sync Health dashboard. */
export function getGraphIntegritySummary(): {
  totalEdges: number;
  totalEmbeddings: number;
  issueCount: number;
  lastScannedAt: number;
  sampleIssues: GraphIntegrityIssue[];
  sampleEmbeddingIssues: EmbeddingIntegrityIssue[];
} {
  const report = auditGraphIntegrity();
  return {
    totalEdges: report.totalEdges,
    totalEmbeddings: report.totalEmbeddings,
    issueCount: report.issueCount,
    lastScannedAt: report.scannedAt,
    sampleIssues: report.issues.slice(0, 10),
    sampleEmbeddingIssues: report.embeddingIssues.slice(0, 10),
  };
}
