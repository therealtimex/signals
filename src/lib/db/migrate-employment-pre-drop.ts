import { backfillEmployments } from "@/lib/db/backfills/employments";
import { columnExists, tableExists } from "@/lib/db/migration-utils";
import { dbPath as clientDbPath, sqlite } from "@/lib/db/client";

/**
 * Backfill legacy company/title scalars while columns still exist.
 * Requires P2 (0018) to have run first — see contact-golden-record §4.2 G3.
 */
export function ensureEmploymentBackfillBeforeCompanyDrop(targetDbPath: string): void {
  if (targetDbPath !== clientDbPath) return;
  if (!tableExists(sqlite, "contact_employments")) return;
  if (!columnExists(sqlite, "contacts", "company")) return;

  backfillEmployments();
}
