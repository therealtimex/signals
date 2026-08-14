import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { backfillOrgs } from "@/lib/db/backfills/orgs";
import { normalizeOrgName } from "@/lib/db/backfills/org-names";
import { syncContactCompanyGraph } from "@/lib/db/contact-org-dual-write";

const SOURCE = "backfill:contacts-company";

/** Create `works_at` edges from contacts with a company string. */
export function backfillWorksAt(): { upserted: number; skipped: number } {
  backfillOrgs();

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

    syncContactCompanyGraph(contact.id, contact.company, contact.title, SOURCE);
    upserted++;
  }

  return { upserted, skipped };
}
