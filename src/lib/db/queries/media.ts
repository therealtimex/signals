import { eq, and, desc, count, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join } from "path";
import { homedir } from "os";
import { existsSync, unlinkSync } from "fs";
import { db } from "@/lib/db/client";
import { mediaAssets, contentItems } from "@/lib/db/schema";
import type { MediaAsset, NewMediaAsset, PaginatedResult } from "@/lib/db/types";

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
export const MEDIA_DIR = join(dataDir, "media");

export function createMediaAsset(
  data: Omit<NewMediaAsset, "id">,
): MediaAsset {
  const id = nanoid();
  db.insert(mediaAssets).values({ ...data, id }).run();
  return db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get()!;
}

export function getMediaAsset(id: string): MediaAsset | undefined {
  return db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
}

export function listMediaAssets(opts?: {
  contentItemId?: string;
  platformTarget?: string;
  page?: number;
  pageSize?: number;
}): PaginatedResult<MediaAsset> {
  const conditions: SQL[] = [];

  if (opts?.contentItemId) {
    conditions.push(eq(mediaAssets.contentItemId, opts.contentItemId));
  }
  if (opts?.platformTarget) {
    conditions.push(
      eq(mediaAssets.platformTarget, opts.platformTarget as "x" | "linkedin"),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ value: count() })
      .from(mediaAssets)
      .where(whereClause)
      .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;

  const rows = db
    .select()
    .from(mediaAssets)
    .where(whereClause)
    .orderBy(desc(mediaAssets.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: rows, total };
}

/** Delete a media asset: removes file from disk, cleans mediaPaths, deletes DB row. */
export function deleteMediaAsset(id: string): boolean {
  const asset = getMediaAsset(id);
  if (!asset) return false;

  // Remove from contentItem.mediaPaths if linked
  if (asset.contentItemId) {
    removeFromMediaPaths(asset.contentItemId, id);
  }

  // Delete file from disk
  const filePath = join(MEDIA_DIR, asset.storagePath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  db.delete(mediaAssets).where(eq(mediaAssets.id, id)).run();
  return true;
}

/** Link a media asset to a content item (sets FK + appends to mediaPaths). */
export function linkMediaToContent(
  assetId: string,
  contentItemId: string,
): void {
  db.update(mediaAssets)
    .set({ contentItemId, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(mediaAssets.id, assetId))
    .run();

  appendToMediaPaths(contentItemId, assetId);
}

/** Unlink a media asset from a content item (clears FK + removes from mediaPaths). */
export function unlinkMediaFromContent(
  assetId: string,
  contentItemId: string,
): void {
  db.update(mediaAssets)
    .set({ contentItemId: null, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(mediaAssets.id, assetId))
    .run();

  removeFromMediaPaths(contentItemId, assetId);
}

/** Get all media assets linked to a content item. */
export function getMediaForContentItem(contentItemId: string): MediaAsset[] {
  return db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.contentItemId, contentItemId))
    .orderBy(mediaAssets.createdAt)
    .all();
}

// --- Internal helpers for mediaPaths JSON array ---

function getMediaPaths(contentItemId: string): string[] {
  const item = db
    .select({ mediaPaths: contentItems.mediaPaths })
    .from(contentItems)
    .where(eq(contentItems.id, contentItemId))
    .get();
  if (!item?.mediaPaths) return [];
  try {
    return JSON.parse(item.mediaPaths) as string[];
  } catch {
    return [];
  }
}

function appendToMediaPaths(contentItemId: string, assetId: string): void {
  const paths = getMediaPaths(contentItemId);
  if (!paths.includes(assetId)) {
    paths.push(assetId);
    db.update(contentItems)
      .set({
        mediaPaths: JSON.stringify(paths),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contentItems.id, contentItemId))
      .run();
  }
}

function removeFromMediaPaths(contentItemId: string, assetId: string): void {
  const paths = getMediaPaths(contentItemId);
  const filtered = paths.filter((p) => p !== assetId);
  db.update(contentItems)
    .set({
      mediaPaths: JSON.stringify(filtered),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(contentItems.id, contentItemId))
    .run();
}
