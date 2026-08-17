import { backfillMediaAttachments } from "@/lib/db/backfills/media-attachments";
import { columnExists, tableExists } from "@/lib/db/migration-utils";
import { dbPath as clientDbPath, sqlite } from "@/lib/db/client";

/** Backfill legacy compose media links while deprecated columns still exist. */
export function ensureMediaAttachmentBackfillBeforeDrop(targetDbPath: string): void {
  if (targetDbPath !== clientDbPath) return;
  if (!tableExists(sqlite, "media_attachments")) return;
  if (!columnExists(sqlite, "media_assets", "content_item_id")) return;

  backfillMediaAttachments();
}
