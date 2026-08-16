import { eq, and, desc, count, SQL, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { join } from "path";
import { homedir } from "os";
import { existsSync, unlinkSync } from "fs";
import { db } from "@/lib/db/client";
import { createMediaAttachment, listAssetsForParent } from "@/lib/db/queries/media-attachments";
import { mediaAssets, contentItems, mediaAttachments } from "@/lib/db/schema";
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
    const attachmentAssetIds = db
      .select({ mediaAssetId: mediaAttachments.mediaAssetId })
      .from(mediaAttachments)
      .where(
        and(
          eq(mediaAttachments.parentType, "content_item"),
          eq(mediaAttachments.parentId, opts.contentItemId),
        ),
      )
      .all()
      .map((row) => row.mediaAssetId);

    if (attachmentAssetIds.length > 0) {
      conditions.push(inArray(mediaAssets.id, attachmentAssetIds));
    } else {
      conditions.push(eq(mediaAssets.contentItemId, opts.contentItemId));
    }
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

/** Delete a media asset: removes file from disk, attachments, legacy mediaPaths, DB row. */
export function deleteMediaAsset(id: string): boolean {
  const asset = getMediaAsset(id);
  if (!asset) return false;

  const attachments = db
    .select()
    .from(mediaAttachments)
    .where(eq(mediaAttachments.mediaAssetId, id))
    .all();

  for (const attachment of attachments) {
    if (attachment.parentType === "content_item") {
      removeFromMediaPaths(attachment.parentId, id);
    }
    db.delete(mediaAttachments).where(eq(mediaAttachments.id, attachment.id)).run();
  }

  if (asset.contentItemId) {
    removeFromMediaPaths(asset.contentItemId, id);
  }

  const filePath = join(MEDIA_DIR, asset.storagePath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  db.delete(mediaAssets).where(eq(mediaAssets.id, id)).run();
  return true;
}

/** Link a media asset to a content item via junction (+ legacy shim). */
export function linkMediaToContent(
  assetId: string,
  contentItemId: string,
  source = "api:link_media",
): void {
  const paths = getMediaPaths(contentItemId);
  const sortOrder = paths.includes(assetId) ? paths.indexOf(assetId) : paths.length;

  db.update(mediaAssets)
    .set({ contentItemId, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(mediaAssets.id, assetId))
    .run();

  createMediaAttachment({
    mediaAssetId: assetId,
    parentType: "content_item",
    parentId: contentItemId,
    role: "attachment",
    sortOrder,
    source,
  });

  appendToMediaPaths(contentItemId, assetId);
}

/** Unlink a media asset from a content item (junction + legacy shim). */
export function unlinkMediaFromContent(
  assetId: string,
  contentItemId: string,
): void {
  db.update(mediaAssets)
    .set({ contentItemId: null, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(mediaAssets.id, assetId))
    .run();

  db.delete(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.mediaAssetId, assetId),
        eq(mediaAttachments.parentType, "content_item"),
        eq(mediaAttachments.parentId, contentItemId),
      ),
    )
    .run();

  removeFromMediaPaths(contentItemId, assetId);
}

/** Get all media assets linked to a content item (junction first, legacy FK fallback). */
export function getMediaForContentItem(contentItemId: string): MediaAsset[] {
  const fromJunction = listAssetsForParent("content_item", contentItemId);
  if (fromJunction.length > 0) return fromJunction;

  return db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.contentItemId, contentItemId))
    .orderBy(mediaAssets.createdAt)
    .all();
}

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
