import { and, count, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";

/**
 * Canonical Contacts-list population.
 *
 * - Archived contacts are hidden by default and included only when requested.
 * - Internal platform-actor rows are never Contacts-list members.
 * - The operator's self contact remains a normal member.
 * - Quarantine candidates live in `snowball_candidates`, not `contacts`, and
 *   enter this population only after promotion creates a contact.
 *
 * Dashboard contact summaries and query_contacts must reuse these conditions
 * so their totals describe the same population as the default Contacts page.
 */
export function defaultContactListVisibilityConditions(opts?: {
  includeArchived?: boolean;
}): SQL[] {
  const conditions: SQL[] = [];
  if (!opts?.includeArchived) {
    conditions.push(sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`);
  }
  conditions.push(sql`json_extract(${contacts.metadata}, '$.platformActor') IS NOT 1`);
  return conditions;
}

export function defaultContactListVisibilityWhere(opts?: {
  includeArchived?: boolean;
}): SQL | undefined {
  const conditions = defaultContactListVisibilityConditions(opts);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function countDefaultContactListPopulation(): number {
  return (
    db
      .select({ value: count() })
      .from(contacts)
      .where(defaultContactListVisibilityWhere())
      .get()?.value ?? 0
  );
}
