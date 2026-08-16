import { eq, and, desc, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join } from "path";
import { homedir } from "os";
import { existsSync, unlinkSync } from "fs";
import { db } from "@/lib/db/client";
import { createMediaAttachment, listAssetsForParent } from "@/lib/db/queries/media-attachments";
import { mediaAssets, mediaAttachments } from "@/lib/db/schema";
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
  page?: number;
  pageSize?: number;
}): PaginatedResult<MediaAsset> {
  if (opts?.contentItemId) {
    const assets = listAssetsForParent("content_item", opts.contentItemId);
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return {
      data: assets.slice(start, start + pageSize),
      total: assets.length,
    };
  }

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;

  const total =
    db
      .select({ value: count() })
      .from(mediaAssets)
      .get()?.value ?? 0;

  const rows = db
    .select()
    .from(mediaAssets)
    .orderBy(desc(mediaAssets.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: rows, total };
}

/** Delete a media asset: removes file from disk, attachments, and DB row. */
export function deleteMediaAsset(id: string): boolean {
  const asset = getMediaAsset(id);
  if (!asset) return false;

  db.delete(mediaAttachments).where(eq(mediaAttachments.mediaAssetId, id)).run();

  const filePath = join(MEDIA_DIR, asset.storagePath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  db.delete(mediaAssets).where(eq(mediaAssets.id, id)).run();
  return true;
}

/** Link a media asset to a content item via `media_attachments`. */
export function linkMediaToContent(
  assetId: string,
  contentItemId: string,
  source = "api:link_media",
): void {
  const existing = listAssetsForParent("content_item", contentItemId);
  const sortOrder = existing.some((asset) => asset.id === assetId)
    ? existing.findIndex((asset) => asset.id === assetId)
    : existing.length;

  createMediaAttachment({
    mediaAssetId: assetId,
    parentType: "content_item",
    parentId: contentItemId,
    role: "attachment",
    sortOrder: Math.max(0, sortOrder),
    source,
  });
}

/** Unlink a media asset from a content item. */
export function unlinkMediaFromContent(
  assetId: string,
  contentItemId: string,
): void {
  db.delete(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.mediaAssetId, assetId),
        eq(mediaAttachments.parentType, "content_item"),
        eq(mediaAttachments.parentId, contentItemId),
      ),
    )
    .run();
}

/** Get all media assets linked to a content item. */
export function getMediaForContentItem(contentItemId: string): MediaAsset[] {
  return listAssetsForParent("content_item", contentItemId);
}
