import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { orgDomains, orgs } from "@/lib/db/schema";

/** Project legacy `orgs.domain` values into the normalized domain identity table. */
export function backfillOrgDomains(): { inserted: number; skipped: number } {
  const rows = db.select({ id: orgs.id, domain: orgs.domain }).from(orgs).all();
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.domain) {
      skipped++;
      continue;
    }
    const result = db
      .insert(orgDomains)
      .values({
        id: nanoid(),
        orgId: row.id,
        domain: row.domain,
        kind: "primary",
        source: "backfill:orgs-domain",
      })
      .onConflictDoNothing({ target: orgDomains.domain })
      .run();
    if (result.changes > 0) inserted++;
    else skipped++;
  }

  return { inserted, skipped };
}
