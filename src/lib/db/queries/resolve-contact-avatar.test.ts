import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { createMediaAsset } from "@/lib/db/queries/media";
import {
  hasVerifiedGravatar,
  resolveContactAvatar,
} from "@/lib/db/queries/resolve-contact-avatar";
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
        gravatarVerified: true,
      }),
    ).toBe(
      `https://www.gravatar.com/avatar/${createHash("md5").update("ada@example.com").digest("hex")}?d=404`,
    );
  });

  it("returns null rather than an unverified gravatar URL", () => {
    // `?d=404` means an address with no Gravatar yields a broken image, and every caller reads a
    // non-null result as "this contact has an avatar".
    expect(resolveContactAvatar({ identities: [], primaryEmail: "ada@example.com" })).toBeNull();
    expect(
      resolveContactAvatar({
        identities: [],
        primaryEmail: "ada@example.com",
        gravatarVerified: false,
      }),
    ).toBeNull();
  });
});

describe("hasVerifiedGravatar", () => {
  it("reads the enrich handler's verification stamp", () => {
    expect(hasVerifiedGravatar('{"avatarEnrich":{"gravatarVerifiedAt":1700000000}}')).toBe(true);
  });

  it("is false for a miss, a missing stamp, junk, and null", () => {
    expect(hasVerifiedGravatar('{"avatarEnrich":{"gravatarMissAt":1700000000}}')).toBe(false);
    expect(hasVerifiedGravatar("{}")).toBe(false);
    expect(hasVerifiedGravatar("not json")).toBe(false);
    expect(hasVerifiedGravatar(null)).toBe(false);
  });
});
