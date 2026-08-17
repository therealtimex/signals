import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { createMediaAsset } from "@/lib/db/queries/media";
import { resolveContactAvatar } from "@/lib/db/queries/resolve-contact-avatar";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("resolveContactAvatar", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("prefers local avatar upload over identity and gravatar", () => {
    const contact = createContact({ name: "Ada" });
    db.insert(contactIdentities)
      .values({
        id: nanoid(),
        contactId: contact.id,
        platform: "x",
        platformUserId: "ada",
        avatarUrl: "https://example.com/identity.jpg",
        isPrimary: 1,
      })
      .run();

    const asset = createMediaAsset({
      filename: "avatar.png",
      storagePath: "avatar.png",
      mimeType: "image/png",
      fileSize: 10,
      origin: "upload",
      scope: "shared",
    });
    createMediaAttachment({
      mediaAssetId: asset.id,
      parentType: "contact",
      parentId: contact.id,
      role: "avatar",
    });

    expect(
      resolveContactAvatar({
        avatarUploadAssetId: asset.id,
        identities: db.select().from(contactIdentities).all(),
        primaryEmail: "ada@example.com",
      }),
    ).toBe(`/api/media/${asset.id}`);
  });

  it("falls back to identity avatar then gravatar", () => {
    const contact = createContact({ name: "Ada" });
    db.insert(contactIdentities)
      .values({
        id: nanoid(),
        contactId: contact.id,
        platform: "x",
        platformUserId: "ada",
        avatarUrl: "https://example.com/identity.jpg",
        isPrimary: 1,
      })
      .run();

    expect(
      resolveContactAvatar({
        identities: db.select().from(contactIdentities).all(),
        primaryEmail: "ada@example.com",
      }),
    ).toBe("https://example.com/identity.jpg");

    expect(
      resolveContactAvatar({
        identities: [],
        primaryEmail: "ada@example.com",
      }),
    ).toBe(
      `https://www.gravatar.com/avatar/${createHash("md5").update("ada@example.com").digest("hex")}?d=404`,
    );
  });
});
