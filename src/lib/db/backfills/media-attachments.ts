import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { mediaAssets, contentItems, mediaAttachments } from "@/lib/db/schema";

const SOURCE = "backfill:content-media";

function readMediaPaths(contentItemId: string): string[] {
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

function hasAttachment(mediaAssetId: string, contentItemId: string): boolean {
  return Boolean(
    db
      .select({ id: mediaAttachments.id })
      .from(mediaAttachments)
      .where(
        and(
          eq(mediaAttachments.mediaAssetId, mediaAssetId),
          eq(mediaAttachments.parentType, "content_item"),
          eq(mediaAttachments.parentId, contentItemId),
          eq(mediaAttachments.role, "attachment"),
        ),
      )
      .get(),
  );
}

/** Backfill compose media links into `media_attachments` (idempotent). */
export function backfillMediaAttachments(): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;

  const linkedAssets = db
    .select()
    .from(mediaAssets)
    .where(isNotNull(mediaAssets.contentItemId))
    .all();

  for (const asset of linkedAssets) {
    const contentItemId = asset.contentItemId;
    if (!contentItemId) continue;

    if (hasAttachment(asset.id, contentItemId)) {
      skipped++;
      continue;
    }

    const paths = readMediaPaths(contentItemId);
    const sortOrder = Math.max(0, paths.indexOf(asset.id));

    createMediaAttachment({
      mediaAssetId: asset.id,
      parentType: "content_item",
      parentId: contentItemId,
      role: "attachment",
      sortOrder: sortOrder >= 0 ? sortOrder : 0,
      source: SOURCE,
    });
    inserted++;
  }

  for (const item of db.select({ id: contentItems.id }).from(contentItems).all()) {
    const paths = readMediaPaths(item.id);
    for (let index = 0; index < paths.length; index++) {
      const assetId = paths[index];
      if (!db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).get()) {
        continue;
      }
      if (hasAttachment(assetId, item.id)) {
        skipped++;
        continue;
      }

      createMediaAttachment({
        mediaAssetId: assetId,
        parentType: "content_item",
        parentId: item.id,
        role: "attachment",
        sortOrder: index,
        source: SOURCE,
      });
      inserted++;
    }
  }

  return { inserted, skipped };
}
