import { and, eq, inArray } from "drizzle-orm";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db/client";
import { attachmentParentExists } from "@/lib/db/queries/media-attachments";
import { MEDIA_DIR } from "@/lib/db/queries/media";
import { countAttachmentsForAsset } from "@/lib/db/queries/media-attachments";
import {
  assertAttachmentParentType,
  type AttachmentParentType,
} from "@/lib/db/media-attachment-types";
import { mediaAssets, mediaAttachments } from "@/lib/db/schema";

const ORPHAN_ASSET_AGE_SECONDS = 24 * 60 * 60;

export type MediaIntegrityIssue = {
  attachmentId: string;
  parentType: AttachmentParentType;
  parentId: string;
  reason: "missing_parent";
};

export type MediaIntegrityReport = {
  scannedAt: number;
  attachmentIssues: MediaIntegrityIssue[];
  orphanedAttachmentsRemoved: number;
  orphanedAssetsRemoved: number;
};

function assetHasLegacyComposeLink(asset: { contentItemId: string | null }): boolean {
  return asset.contentItemId !== null && asset.contentItemId !== undefined;
}

export function runMediaIntegrityJob(opts?: { repair?: boolean }): MediaIntegrityReport {
  const repair = opts?.repair ?? false;
  const attachmentIssues: MediaIntegrityIssue[] = [];
  let orphanedAttachmentsRemoved = 0;
  let orphanedAssetsRemoved = 0;

  const attachments = db.select().from(mediaAttachments).all();
  for (const attachment of attachments) {
    const parentType = assertAttachmentParentType(attachment.parentType);
    if (!attachmentParentExists(parentType, attachment.parentId)) {
      attachmentIssues.push({
        attachmentId: attachment.id,
        parentType,
        parentId: attachment.parentId,
        reason: "missing_parent",
      });
      if (repair) {
        db.delete(mediaAttachments).where(eq(mediaAttachments.id, attachment.id)).run();
        orphanedAttachmentsRemoved++;
      }
    }
  }

  if (repair) {
    const now = Math.floor(Date.now() / 1000);
    const assets = db.select().from(mediaAssets).all();
    for (const asset of assets) {
      const attachmentCount = countAttachmentsForAsset(asset.id);
      const hasComposeLink = assetHasLegacyComposeLink(asset);
      if (attachmentCount > 0 || hasComposeLink) continue;

      const age = now - asset.createdAt;
      if (age < ORPHAN_ASSET_AGE_SECONDS) continue;

      const filePath = join(MEDIA_DIR, asset.storagePath);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id)).run();
      orphanedAssetsRemoved++;
    }
  }

  return {
    scannedAt: Math.floor(Date.now() / 1000),
    attachmentIssues,
    orphanedAttachmentsRemoved,
    orphanedAssetsRemoved,
  };
}

export function deleteOrphanedAttachmentsForParents(
  parentType: AttachmentParentType,
  parentIds: string[],
): number {
  if (parentIds.length === 0) return 0;
  const rows = db
    .select()
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.parentType, parentType),
        inArray(mediaAttachments.parentId, parentIds),
      ),
    )
    .all();

  let removed = 0;
  for (const row of rows) {
    if (!attachmentParentExists(parentType, row.parentId)) {
      db.delete(mediaAttachments).where(eq(mediaAttachments.id, row.id)).run();
      removed++;
    }
  }
  return removed;
}
