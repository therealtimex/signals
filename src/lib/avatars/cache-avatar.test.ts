import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createContact } from "@/lib/db/queries/contacts";
import { getMediaAsset, MEDIA_DIR } from "@/lib/db/queries/media";
import { loadContactAvatarUploadAssetId } from "@/lib/db/queries/contact-dto";
import { resolveContactAvatar } from "@/lib/db/queries/resolve-contact-avatar";
import { cacheAvatarFromUrl, MAX_AVATAR_BYTES } from "@/lib/avatars/cache-avatar";
import { resetCoreTables } from "@/test/db";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function respond(body: Uint8Array | null, status = 200, contentType = "image/png"): typeof fetch {
  const payload = body ? (body.buffer.slice(0) as ArrayBuffer) : null;
  return vi.fn(async () =>
    new Response(payload, { status, headers: contentType ? { "content-type": contentType } : {} }),
  ) as unknown as typeof fetch;
}

describe("cacheAvatarFromUrl", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("stores the bytes and makes the contact resolve to a local path", async () => {
    const contact = createContact({ name: "Cached" });

    const result = await cacheAvatarFromUrl(
      contact.id,
      "https://unavatar.io/linkedin/user:someone",
      respond(new Uint8Array(PIXEL)),
    );

    expect(result.status).toBe("cached");
    const assetId = loadContactAvatarUploadAssetId(contact.id);
    expect(assetId).toBeTruthy();

    const asset = getMediaAsset(assetId!)!;
    // Provenance: distinguishes a cached remote avatar from an operator upload.
    expect(asset.origin).toBe("platform_cache");
    expect(asset.sourceUrl).toBe("https://unavatar.io/linkedin/user:someone");
    expect(asset.sha256).toHaveLength(64);
    expect(existsSync(join(MEDIA_DIR, asset.storagePath))).toBe(true);

    // The whole point of #431: rendering no longer references the rate-limited host.
    const resolved = resolveContactAvatar({ identities: [], avatarUploadAssetId: assetId });
    expect(resolved).toBe(`/api/media/${assetId}`);
    expect(resolved).not.toContain("unavatar.io");
  });

  it("treats throttling and server errors as transient, not as a verdict", async () => {
    const contact = createContact({ name: "Throttled" });

    for (const status of [429, 500, 503]) {
      const result = await cacheAvatarFromUrl(contact.id, "https://x.test/a.png", respond(null, status));
      expect(result).toMatchObject({ status: "transient" });
    }
    expect(loadContactAvatarUploadAssetId(contact.id)).toBeNull();
  });

  it("treats a 404 and a non-image body as a miss", async () => {
    const contact = createContact({ name: "Missing" });

    expect(
      await cacheAvatarFromUrl(contact.id, "https://x.test/a.png", respond(null, 404)),
    ).toMatchObject({ status: "miss" });

    // unavatar answers 200 text/html when it has nothing; that must not become an avatar.
    expect(
      await cacheAvatarFromUrl(
        contact.id,
        "https://x.test/a.png",
        respond(new Uint8Array(Buffer.from("<html>")), 200, "text/html"),
      ),
    ).toMatchObject({ status: "miss" });

    expect(loadContactAvatarUploadAssetId(contact.id)).toBeNull();
  });

  it("rejects an empty body and an oversized one", async () => {
    const contact = createContact({ name: "Weird" });

    expect(
      await cacheAvatarFromUrl(contact.id, "https://x.test/a.png", respond(new Uint8Array(0))),
    ).toMatchObject({ status: "miss" });

    const huge = new Uint8Array(MAX_AVATAR_BYTES + 1);
    expect(
      await cacheAvatarFromUrl(contact.id, "https://x.test/a.png", respond(huge)),
    ).toMatchObject({ status: "miss" });

    expect(loadContactAvatarUploadAssetId(contact.id)).toBeNull();
  });

  it("reports a network failure as transient rather than throwing", async () => {
    const contact = createContact({ name: "Offline" });
    const failing = vi.fn(async () => {
      throw new Error("ENOTFOUND unavatar.io");
    }) as unknown as typeof fetch;

    expect(
      await cacheAvatarFromUrl(contact.id, "https://unavatar.io/x/nobody", failing),
    ).toMatchObject({ status: "transient", message: "ENOTFOUND unavatar.io" });
  });
});
