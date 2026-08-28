import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgDomains, orgs } from "@/lib/db/schema";
import { normalizeOrgDomain } from "@/lib/orgs/domain";

/**
 * Project legacy `orgs.domain` values into the normalized domain identity table.
 * Canonical collisions are owned by the lexicographically smallest org id.
 */
export function backfillOrgDomains(): {
  inserted: number;
  skipped: number;
  normalized: number;
  conflicts: number;
  invalid: number;
} {
  const rows = db.select({ id: orgs.id, domain: orgs.domain }).from(orgs).all()
    .sort((a, b) => a.id.localeCompare(b.id));
  let inserted = 0;
  let skipped = 0;
  let normalized = 0;
  let conflicts = 0;
  let invalid = 0;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.domain) {
      skipped++;
      continue;
    }
    const result = normalizeOrgDomain(row.domain);
    if (!result.ok) {
      db.update(orgs).set({ domain: null }).where(eq(orgs.id, row.id)).run();
      db.delete(orgDomains).where(and(eq(orgDomains.orgId, row.id), eq(orgDomains.kind, "primary"))).run();
      invalid++;
      continue;
    }
    const group = groups.get(result.domain) ?? [];
    group.push(row);
    groups.set(result.domain, group);
  }

  for (const [domain, group] of groups) {
    const winner = group[0];
    const losers = group.filter((row) => row.id !== winner.id);

    // Clear duplicates before writing the canonical value so the legacy unique index cannot race us.
    for (const loser of losers) {
      db.update(orgs).set({ domain: null }).where(eq(orgs.id, loser.id)).run();
      db.delete(orgDomains).where(and(eq(orgDomains.orgId, loser.id), eq(orgDomains.kind, "primary"))).run();
      conflicts++;
    }

    if (winner.domain !== domain) normalized++;
    db.update(orgs).set({ domain }).where(eq(orgs.id, winner.id)).run();

    const canonical = db.select().from(orgDomains).where(eq(orgDomains.domain, domain)).get();
    if (canonical) {
      db.update(orgDomains).set({ orgId: winner.id, kind: "primary" })
        .where(eq(orgDomains.id, canonical.id)).run();
      for (const other of db.select().from(orgDomains).where(and(
        eq(orgDomains.orgId, winner.id), eq(orgDomains.kind, "primary"),
      )).all()) {
        if (other.id !== canonical.id) db.delete(orgDomains).where(eq(orgDomains.id, other.id)).run();
      }
      skipped++;
      continue;
    }

    const primary = db.select().from(orgDomains).where(and(
      eq(orgDomains.orgId, winner.id), eq(orgDomains.kind, "primary"),
    )).get();
    if (primary) {
      db.update(orgDomains).set({ domain, source: "backfill:orgs-domain" })
        .where(eq(orgDomains.id, primary.id)).run();
      normalized++;
    } else {
      db.insert(orgDomains).values({
        id: nanoid(),
        orgId: winner.id,
        domain,
        kind: "primary",
        source: "backfill:orgs-domain",
      }).run();
      inserted++;
    }
  }

  return { inserted, skipped, normalized, conflicts, invalid };
}
