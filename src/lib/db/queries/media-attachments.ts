import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  assertAttachmentParentType,
  assertAttachmentRole,
  type AttachmentParentType,
  type AttachmentRole,
} from "@/lib/db/media-attachment-types";
import {
  contacts,
  contentItems,
  interactions,
  mediaAttachments,
  mediaAssets,
  orgs,
} from "@/lib/db/schema";
import type { MediaAsset, MediaAttachment, NewMediaAttachment } from "@/lib/db/types";

export class MediaAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaAttachmentError";
  }
}

export type CreateMediaAttachmentInput = {
  mediaAssetId: string;
  parentType: AttachmentParentType;
  parentId: string;
  role?: AttachmentRole;
  sortOrder?: number;
  caption?: string | null;
  source?: string;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function attachmentParentExists(parentType: AttachmentParentType, parentId: string): boolean {
  switch (parentType) {
    case "contact":
      return Boolean(
        db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, parentId)).get(),
      );
    case "org":
      return Boolean(db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, parentId)).get());
    case "content_item":
      return Boolean(
        db
          .select({ id: contentItems.id })
          .from(contentItems)
          .where(eq(contentItems.id, parentId))
          .get(),
      );
    case "interaction":
      return Boolean(
        db
          .select({ id: interactions.id })
          .from(interactions)
          .where(eq(interactions.id, parentId))
          .get(),
      );
    default:
      return false;
  }
}

export function validateAttachmentParent(
  parentType: AttachmentParentType,
  parentId: string,
): void {
  if (!attachmentParentExists(parentType, parentId)) {
    throw new MediaAttachmentError(`Attachment parent not found: ${parentType}:${parentId}`);
  }
}

function replaceAvatarAttachment(
  parentType: AttachmentParentType,
  parentId: string,
  keepAssetId: string,
): void {
  const existing = db
    .select()
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.parentType, parentType),
        eq(mediaAttachments.parentId, parentId),
        eq(mediaAttachments.role, "avatar"),
      ),
    )
    .all();

  for (const row of existing) {
    if (row.mediaAssetId === keepAssetId) continue;
    db.delete(mediaAttachments).where(eq(mediaAttachments.id, row.id)).run();
  }
}

export function createMediaAttachment(input: CreateMediaAttachmentInput): MediaAttachment {
  const parentType = assertAttachmentParentType(input.parentType);
  const role = assertAttachmentRole(input.role ?? "attachment");
  validateAttachmentParent(parentType, input.parentId);

  const asset = db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.mediaAssetId))
    .get();
  if (!asset) {
    throw new MediaAttachmentError(`Media asset not found: ${input.mediaAssetId}`);
  }

  if (role === "avatar") {
    replaceAvatarAttachment(parentType, input.parentId, input.mediaAssetId);
  }

  const existing = db
    .select()
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.mediaAssetId, input.mediaAssetId),
        eq(mediaAttachments.parentType, parentType),
        eq(mediaAttachments.parentId, input.parentId),
        eq(mediaAttachments.role, role),
      ),
    )
    .get();
  if (existing) return existing;

  const id = nanoid();
  const now = nowUnix();
  db.insert(mediaAttachments)
    .values({
      id,
      mediaAssetId: input.mediaAssetId,
      parentType,
      parentId: input.parentId,
      role,
      sortOrder: input.sortOrder ?? 0,
      caption: input.caption ?? null,
      source: input.source ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies NewMediaAttachment)
    .run();

  return db.select().from(mediaAttachments).where(eq(mediaAttachments.id, id)).get()!;
}

export function listAttachmentsForParent(
  parentType: AttachmentParentType,
  parentId: string,
): MediaAttachment[] {
  return db
    .select()
    .from(mediaAttachments)
    .where(
      and(eq(mediaAttachments.parentType, parentType), eq(mediaAttachments.parentId, parentId)),
    )
    .orderBy(asc(mediaAttachments.sortOrder), asc(mediaAttachments.createdAt))
    .all();
}

export function listAssetsForParent(
  parentType: AttachmentParentType,
  parentId: string,
  opts?: { sharedOnly?: boolean },
): MediaAsset[] {
  const attachments = listAttachmentsForParent(parentType, parentId);
  if (attachments.length === 0) return [];

  const assets: MediaAsset[] = [];
  for (const attachment of attachments) {
    const asset = db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, attachment.mediaAssetId))
      .get();
    if (!asset) continue;
    if (opts?.sharedOnly && asset.scope !== "shared") continue;
    assets.push(asset);
  }
  return assets;
}

export function deleteAttachmentsForParent(
  parentType: AttachmentParentType,
  parentId: string,
): number {
  const rows = listAttachmentsForParent(parentType, parentId);
  for (const row of rows) {
    db.delete(mediaAttachments).where(eq(mediaAttachments.id, row.id)).run();
  }
  return rows.length;
}

export function countAttachmentsForAsset(mediaAssetId: string): number {
  return db
    .select()
    .from(mediaAttachments)
    .where(eq(mediaAttachments.mediaAssetId, mediaAssetId))
    .all().length;
}
