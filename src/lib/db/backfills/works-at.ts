import { isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { backfillOrgs, buildOrgLookupByName, findOrgIdForCompany } from "@/lib/db/backfills/orgs";
import { normalizeOrgName } from "@/lib/db/backfills/org-names";
import { upsertGraphEdge } from "@/lib/db/queries/graph";

const SOURCE = "backfill:contacts-company";

/** Create `works_at` edges from contacts with a company string. */
export function backfillWorksAt(): { upserted: number; skipped: number } {
  // Ensure org nodes exist first
  backfillOrgs();

  const lookup = buildOrgLookupByName();
  const rows = db
    .select({
      id: contacts.id,
      company: contacts.company,
      title: contacts.title,
    })
    .from(contacts)
    .where(isNotNull(contacts.company))
    .all();

  let upserted = 0;
  let skipped = 0;

  for (const contact of rows) {
    if (!contact.company || !normalizeOrgName(contact.company)) {
      skipped++;
      continue;
    }

    const orgId = findOrgIdForCompany(contact.company, lookup);
    if (!orgId) {
      skipped++;
      continue;
    }

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: orgId,
      edgeType: "works_at",
      properties: JSON.stringify({
        title: contact.title ?? null,
        is_current: true,
      }),
      scope: "shared",
      source: SOURCE,
    });
    upserted++;
  }

  return { upserted, skipped };
}
