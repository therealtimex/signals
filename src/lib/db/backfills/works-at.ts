import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { backfillOrgs } from "@/lib/db/backfills/orgs";
import { normalizeOrgName } from "@/lib/db/backfills/org-names";
import { syncContactCompanyGraph } from "@/lib/db/contact-org-dual-write";

const SOURCE = "backfill:contacts-company";

/** Reconcile `works_at` edges from every contact's current company projection. */
export function backfillWorksAt(): { upserted: number; skipped: number } {
  backfillOrgs();

  const rows = db
    .select({
      id: contacts.id,
      company: contacts.company,
      title: contacts.title,
    })
    .from(contacts)
    .all();

  let upserted = 0;
  let skipped = 0;

  for (const contact of rows) {
    const normalized = contact.company ? normalizeOrgName(contact.company) : "";
    if (!normalized) {
      const result = syncContactCompanyGraph(contact.id, null, null, SOURCE);
      if (result.retiredEdges > 0) {
        upserted++;
      } else {
        skipped++;
      }
      continue;
    }

    syncContactCompanyGraph(contact.id, contact.company, contact.title, SOURCE);
    upserted++;
  }

  return { upserted, skipped };
}
