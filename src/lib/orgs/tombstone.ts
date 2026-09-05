import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";

/**
 * Org tombstone helpers.
 *
 * These live outside the merge module because `queries/orgs.ts` needs them — `ensureOrgByName` has
 * to resolve through a tombstone — and the merge module imports `recalcOrgEnrichment` from there.
 * `merge.ts` re-exports both, so the contract in specs/org-merge.md §3 still reads as promised.
 */

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The org this record was merged into, or null while it is still live. */
export function mergedIntoOrgId(metadata: string | null | undefined): string | null {
  const value = parseMetadata(metadata).mergedIntoOrgId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Follow a tombstone chain to the org that is actually alive.
 *
 * Bounded because a cycle would otherwise hang the import path that calls it.
 */
export function resolveSurvivingOrgId(orgId: string, maxHops = 10): string {
  let current = orgId;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const row = db.select({ metadata: orgs.metadata }).from(orgs).where(eq(orgs.id, current)).get();
    const next = mergedIntoOrgId(row?.metadata);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}
