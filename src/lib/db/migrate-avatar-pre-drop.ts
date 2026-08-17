import { columnExists, tableExists } from "@/lib/db/migration-utils";
import { backfillIdentityAvatars } from "@/lib/db/backfills/identity-avatars";
import { dbPath as clientDbPath, sqlite } from "@/lib/db/client";

/** Backfill legacy avatar scalars while columns still exist. */
export function ensureAvatarBackfillBeforeDrop(targetDbPath: string): void {
  if (targetDbPath !== clientDbPath) return;
  if (!tableExists(sqlite, "contact_identities")) return;
  if (!columnExists(sqlite, "contacts", "avatar_url")) return;

  backfillIdentityAvatars();
}
