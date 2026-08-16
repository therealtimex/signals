import { nanoid } from "nanoid";
import { sqlite } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";
import { db } from "@/lib/db/client";
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

function readScalarCompanies(): string[] {
  try {
    const rows = sqlite
      .prepare(
        `SELECT DISTINCT company AS company
         FROM contacts
         WHERE company IS NOT NULL AND trim(company) != ''`,
      )
      .all() as { company: string }[];
    return rows.map((row) => row.company);
  } catch {
    return [];
  }
}

/** Insert orgs from distinct legacy `contacts.company` values when the column still exists. */
export function backfillOrgs(): { inserted: number } {
  const lookup = buildOrgLookupByName();
  let inserted = 0;

  for (const company of readScalarCompanies()) {
    const displayName = normalizeOrgName(company);
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
