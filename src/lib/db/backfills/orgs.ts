import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contacts, orgs } from "@/lib/db/schema";
import { normalizeOrgName, orgDedupeKey } from "@/lib/db/backfills/org-names";

const SOURCE = "backfill:contacts-company";

/** Build org lookup keyed by normalized company name. */
export function buildOrgLookupByName(): Map<string, { id: string; name: string }> {
  const lookup = new Map<string, { id: string; name: string }>();
  for (const org of db.select().from(orgs).all()) {
    lookup.set(orgDedupeKey(org.name), { id: org.id, name: org.name });
  }
  return lookup;
}

/** Insert orgs from distinct `contacts.company` values. Idempotent by normalized name. */
export function backfillOrgs(): { inserted: number } {
  const rows = db
    .select({ company: contacts.company })
    .from(contacts)
    .where(sql`trim(${contacts.company}) != ''`)
    .all();

  const lookup = buildOrgLookupByName();
  let inserted = 0;

  for (const row of rows) {
    if (!row.company) continue;
    const displayName = normalizeOrgName(row.company);
    if (!displayName) continue;

    const key = orgDedupeKey(displayName);
    if (lookup.has(key)) continue;

    const id = nanoid();
    db.insert(orgs)
      .values({
        id,
        name: displayName,
        source: SOURCE,
        scope: "shared",
      })
      .run();

    lookup.set(key, { id, name: displayName });
    inserted++;
  }

  return { inserted };
}

export function findOrgIdForCompany(
  company: string,
  lookup?: Map<string, { id: string; name: string }>,
): string | undefined {
  const map = lookup ?? buildOrgLookupByName();
  return map.get(orgDedupeKey(company))?.id;
}
