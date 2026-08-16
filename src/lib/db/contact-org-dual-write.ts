import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { graphEdges } from "@/lib/db/schema";
import { ensureOrgByName, getOrgById } from "@/lib/db/queries/orgs";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { normalizeOrgName } from "@/lib/db/backfills/org-names";

function retireWorksAtEdges(contactId: string, keepOrgId?: string): number {
  const existing = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.edgeType, "works_at"),
      ),
    )
    .all();

  let retired = 0;
  for (const edge of existing) {
    if (keepOrgId && edge.dstId === keepOrgId) continue;
    db.delete(graphEdges).where(eq(graphEdges.id, edge.id)).run();
    retired++;
  }
  return retired;
}

/** Reconcile `works_at` edges when `contacts.company` changes or clears. */
export function syncContactCompanyGraph(
  contactId: string,
  company: string | null | undefined,
  title?: string | null,
  source = "agent:create_contact",
): { orgId?: string; edgeId?: string; retiredEdges: number } {
  const normalized = company ? normalizeOrgName(company) : "";
  if (!normalized) {
    return { retiredEdges: retireWorksAtEdges(contactId) };
  }

  const org = ensureOrgByName(company!, source);
  const retiredEdges = retireWorksAtEdges(contactId, org.id);

  const edge = upsertGraphEdge({
    srcType: "contact",
    srcId: contactId,
    dstType: "org",
    dstId: org.id,
    edgeType: "works_at",
    properties: JSON.stringify({
      title: title ?? null,
      is_current: true,
    }),
    scope: "shared",
    source,
  });

  return { orgId: org.id, edgeId: edge.id, retiredEdges };
}

/** Link a contact to an exact org node by ID (authoritative when `orgId` is supplied). */
export function syncContactOrgGraph(
  contactId: string,
  orgId: string,
  title?: string | null,
  source = "api:create_contact",
): { orgId: string; edgeId?: string; retiredEdges: number } {
  const org = getOrgById(orgId);
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const retiredEdges = retireWorksAtEdges(contactId, orgId);

  const edge = upsertGraphEdge({
    srcType: "contact",
    srcId: contactId,
    dstType: "org",
    dstId: orgId,
    edgeType: "works_at",
    properties: JSON.stringify({
      title: title ?? null,
      is_current: true,
    }),
    scope: "shared",
    source,
  });

  return { orgId, edgeId: edge.id, retiredEdges };
}

export function getContactWorksAtOrgId(contactId: string): string | undefined {
  const edges = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.edgeType, "works_at"),
      ),
    )
    .all();

  if (edges.length === 0) return undefined;
  const shared = edges.find((edge) => edge.scope === "shared");
  return (shared ?? edges[0])?.dstId;
}

/** Refresh `works_at` title while preserving an existing org link when present. */
export function syncContactWorksAtFromContact(
  contactId: string,
  company: string | null | undefined,
  title?: string | null,
  source = "api:update_contact",
): { orgId?: string; edgeId?: string; retiredEdges: number } {
  const existingOrgId = getContactWorksAtOrgId(contactId);
  if (existingOrgId) {
    return syncContactOrgGraph(contactId, existingOrgId, title, source);
  }
  return syncContactCompanyGraph(contactId, company, title, source);
}

/** Dual-write `contacts.company` into org node + `works_at` edge (projection stays on contacts). */
export function dualWriteContactCompany(
  contactId: string,
  company: string | null | undefined,
  title?: string | null,
): { orgId?: string; edgeId?: string } {
  const result = syncContactCompanyGraph(contactId, company, title);
  return { orgId: result.orgId, edgeId: result.edgeId };
}
