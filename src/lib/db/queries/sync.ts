import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { syncCursors } from "@/lib/db/schema";
import type { SyncCursor, NewSyncCursor } from "@/lib/db/types";

type DataType = "tweets" | "mentions" | "followers" | "following" | "dms" | "likes" | "connections" | "google_contacts" | "gmail_metadata" | "x_profiles" | "himalaya_correspondents" | "himalaya_mail_activity";

/** Get or create a sync cursor for a specific (platformAccountId, dataType). */
export function getSyncCursor(
  platformAccountId: string,
  dataType: DataType
): SyncCursor {
  const existing = db
    .select()
    .from(syncCursors)
    .where(
      and(
        eq(syncCursors.platformAccountId, platformAccountId),
        eq(syncCursors.dataType, dataType)
      )
    )
    .get();

  if (existing) return existing;

  // Create a new cursor
  const id = nanoid();
  db.insert(syncCursors)
    .values({
      id,
      platformAccountId,
      dataType,
    })
    .run();

  return db.select().from(syncCursors).where(eq(syncCursors.id, id)).get()!;
}

/** Update sync cursor position and stats. */
export function updateSyncCursor(
  id: string,
  data: Partial<Pick<SyncCursor,
    | "cursor"
    | "oldestFetchedAt"
    | "newestFetchedAt"
    | "totalItemsSynced"
    | "syncStatus"
    | "syncProgress"
    | "syncDirection"
    | "lastSyncStartedAt"
    | "lastSyncCompletedAt"
    | "lastError"
  >>
): SyncCursor | undefined {
  const existing = db.select().from(syncCursors).where(eq(syncCursors.id, id)).get();
  if (!existing) return undefined;

  db.update(syncCursors)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(syncCursors.id, id))
    .run();

  return db.select().from(syncCursors).where(eq(syncCursors.id, id)).get();
}

/** List all sync cursors for a platform account. */
export function listSyncCursors(platformAccountId: string): SyncCursor[] {
  return db
    .select()
    .from(syncCursors)
    .where(eq(syncCursors.platformAccountId, platformAccountId))
    .all();
}
