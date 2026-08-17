import { backfillChannels } from "@/lib/db/backfills/channels";
import { columnExists, tableExists } from "@/lib/db/migration-utils";
import { dbPath as clientDbPath, sqlite } from "@/lib/db/client";

/** Backfill legacy channel scalars while deprecated columns still exist. */
export function ensureChannelBackfillBeforeDrop(targetDbPath: string): void {
  if (targetDbPath !== clientDbPath) return;
  if (!tableExists(sqlite, "contact_channels")) return;
  if (!columnExists(sqlite, "contacts", "email")) return;

  backfillChannels();
}
