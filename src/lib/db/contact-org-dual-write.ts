import { ensureOrgByName } from "@/lib/db/queries/orgs";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { normalizeOrgName } from "@/lib/db/backfills/org-names";

/** Dual-write `contacts.company` into org node + `works_at` edge (projection stays on contacts). */
export function dualWriteContactCompany(
  contactId: string,
  company: string | null | undefined,
  title?: string | null,
): { orgId?: string; edgeId?: string } {
  if (!company || !normalizeOrgName(company)) {
    return {};
  }

  const org = ensureOrgByName(company, "agent:create_contact");
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
    source: "agent:create_contact",
  });

  return { orgId: org.id, edgeId: edge.id };
}
