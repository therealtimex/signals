import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import {
  createMediaAttachment,
  listAssetsForParent,
  listAttachmentsForParent,
} from "@/lib/db/queries/media-attachments";
import { createMediaAsset, linkMediaToContent } from "@/lib/db/queries/media";
import { backfillMediaAttachments } from "@/lib/db/backfills/media-attachments";
import { runMediaIntegrityJob } from "@/lib/db/media-integrity";
import { db } from "@/lib/db/client";
import { contacts, contentItems, mediaAttachments } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("media attachments", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("attaches assets to contacts and replaces avatar role uniquely", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada-media" });
    const avatarA = createMediaAsset({
      filename: "a.png",
      storagePath: "a.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "shared",
      contentItemId: null,
      platformTarget: null,
    });
    const avatarB = createMediaAsset({
      filename: "b.png",
      storagePath: "b.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "shared",
      contentItemId: null,
      platformTarget: null,
    });

    createMediaAttachment({
      mediaAssetId: avatarA.id,
      parentType: "contact",
      parentId: contact.id,
      role: "avatar",
      source: "test",
    });
    createMediaAttachment({
      mediaAssetId: avatarB.id,
      parentType: "contact",
      parentId: contact.id,
      role: "avatar",
      source: "test",
    });

    const avatars = listAttachmentsForParent("contact", contact.id).filter(
      (row) => row.role === "avatar",
    );
    expect(avatars).toHaveLength(1);
    expect(avatars[0]?.mediaAssetId).toBe(avatarB.id);
  });

  it("links compose media through junction rows and backfills legacy FK links", () => {
    const contentItemId = nanoid();
    db.insert(contentItems)
      .values({
        id: contentItemId,
        contentType: "post",
        status: "draft",
        mediaPaths: "[]",
      })
      .run();

    const asset = createMediaAsset({
      filename: "deck.pdf",
      storagePath: "deck.pdf",
      mimeType: "application/pdf",
      fileSize: 100,
      origin: "upload",
      scope: "shared",
      contentItemId,
      platformTarget: "linkedin",
    });

    linkMediaToContent(asset.id, contentItemId);

    const linked = listAssetsForParent("content_item", contentItemId);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.id).toBe(asset.id);

    db.delete(mediaAttachments).run();
    const backfill = backfillMediaAttachments();
    expect(backfill.inserted).toBeGreaterThan(0);
    expect(listAssetsForParent("content_item", contentItemId)).toHaveLength(1);
  });

  it("filters local_only assets from shared parent reads", () => {
    const contact = createContact({ name: "Private", platform: "x", platformUserId: "private-media" });
    const shared = createMediaAsset({
      filename: "shared.png",
      storagePath: "shared.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "shared",
      contentItemId: null,
      platformTarget: null,
    });
    const local = createMediaAsset({
      filename: "local.png",
      storagePath: "local.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "local_only",
      contentItemId: null,
      platformTarget: null,
    });

    createMediaAttachment({
      mediaAssetId: shared.id,
      parentType: "contact",
      parentId: contact.id,
      source: "test",
    });
    createMediaAttachment({
      mediaAssetId: local.id,
      parentType: "contact",
      parentId: contact.id,
      source: "test",
    });

    expect(listAssetsForParent("contact", contact.id, { sharedOnly: true })).toHaveLength(1);
    expect(listAssetsForParent("contact", contact.id)).toHaveLength(2);
  });

  it("removes orphaned attachments when parent is deleted", () => {
    const contact = createContact({ name: "Gone", platform: "x", platformUserId: "gone-media" });
    const asset = createMediaAsset({
      filename: "file.png",
      storagePath: "file.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "local_only",
      contentItemId: null,
      platformTarget: null,
    });

    createMediaAttachment({
      mediaAssetId: asset.id,
      parentType: "contact",
      parentId: contact.id,
      source: "test",
    });

    db.delete(contentItems).run();
    db.delete(contacts).where(eq(contacts.id, contact.id)).run();

    const report = runMediaIntegrityJob({ repair: true });
    expect(report.orphanedAttachmentsRemoved).toBe(1);
    expect(db.select().from(mediaAttachments).all()).toHaveLength(0);
  });
});
