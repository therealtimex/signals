import { columnExists, tableExists } from "@/lib/db/migration-utils";
import { backfillIdentityProfile } from "@/lib/db/backfills/identity-profile";
import { dbPath as clientDbPath, sqlite } from "@/lib/db/client";

/** Backfill legacy profile scalars while columns still exist. */
export function ensureProfileBackfillBeforeDrop(targetDbPath: string): void {
  if (targetDbPath !== clientDbPath) return;
  if (!tableExists(sqlite, "contact_identities")) return;
  if (!columnExists(sqlite, "contacts", "headline")) return;
  if (!columnExists(sqlite, "contact_identities", "headline")) return;

  backfillIdentityProfile();
}
