import { backfillEmployments } from "@/lib/db/backfills/employments";
import { backfillOrgs } from "@/lib/db/backfills/orgs";

/** Reconcile `works_at` edges from contact employments (employment is source of truth). */
export function backfillWorksAt(): { upserted: number; skipped: number } {
  backfillOrgs();
  const result = backfillEmployments();
  return { upserted: result.inserted, skipped: result.skipped };
}
