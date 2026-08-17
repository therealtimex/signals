import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { mediaAssets, mediaAttachments } from "@/lib/db/schema";

const SOURCE = "backfill:content-media";

type LegacyAssetRow = {
  id: string;
  contentItemId: string;
};

function readLegacyLinkedAssets(): LegacyAssetRow[] {
  try {
    return sqlite
      .prepare(
        `SELECT id, content_item_id AS contentItemId
         FROM media_assets
         WHERE content_item_id IS NOT NULL`,
      )
      .all() as LegacyAssetRow[];
  } catch {
    return [];
  }
}

function readLegacyMediaPaths(contentItemId: string): string[] {
  try {
    const row = sqlite
      .prepare(`SELECT media_paths AS mediaPaths FROM content_items WHERE id = ?`)
      .get(contentItemId) as { mediaPaths: string | null } | undefined;
    if (!row?.mediaPaths) return [];
    return JSON.parse(row.mediaPaths) as string[];
  } catch {
    return [];
  }
}

function readLegacyContentItemIds(): string[] {
  try {
    const rows = sqlite
      .prepare(`SELECT id FROM content_items`)
      .all() as { id: string }[];
    return rows.map((row) => row.id);
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

  for (const asset of readLegacyLinkedAssets()) {
    if (hasAttachment(asset.id, asset.contentItemId)) {
      skipped++;
      continue;
    }

    const paths = readLegacyMediaPaths(asset.contentItemId);
    const sortOrder = Math.max(0, paths.indexOf(asset.id));

    createMediaAttachment({
      mediaAssetId: asset.id,
      parentType: "content_item",
      parentId: asset.contentItemId,
      role: "attachment",
      sortOrder: sortOrder >= 0 ? sortOrder : 0,
      source: SOURCE,
    });
    inserted++;
  }

  for (const contentItemId of readLegacyContentItemIds()) {
    const paths = readLegacyMediaPaths(contentItemId);
    for (let index = 0; index < paths.length; index++) {
      const assetId = paths[index];
      if (!db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, assetId)).get()) {
        continue;
      }
      if (hasAttachment(assetId, contentItemId)) {
        skipped++;
        continue;
      }

      createMediaAttachment({
        mediaAssetId: assetId,
        parentType: "content_item",
        parentId: contentItemId,
        role: "attachment",
        sortOrder: index,
        source: SOURCE,
      });
      inserted++;
    }
  }

  return { inserted, skipped };
}
