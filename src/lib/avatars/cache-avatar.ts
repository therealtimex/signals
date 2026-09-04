import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { createMediaAsset, MEDIA_DIR } from "@/lib/db/queries/media";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";

/**
 * Avatars must not be fetched from a third party at render time. `unavatar.io` — the resolver the
 * enrichment chain leans on — allows roughly 50 requests/day even on a paid key, and the contact
 * list renders 25 rows at a time, so a single scroll exhausts the quota and every dependent row
 * falls back to initials (#431). Fetch once here, store the bytes, and let `resolveContactAvatar`
 * serve `/api/media/<id>` off disk.
 */
export const AVATAR_FETCH_TIMEOUT_MS = 10_000;

/** Portraits are small; anything larger is a redirect to something that is not an avatar. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

export type AvatarCacheResult =
  | { status: "cached"; mediaAssetId: string; bytes: number }
  | { status: "miss"; reason: string }
  | { status: "transient"; message: string };

function extensionFor(mimeType: string): string | undefined {
  return EXTENSION_BY_MIME[mimeType.split(";")[0]!.trim().toLowerCase()];
}

/**
 * Download `url` and attach it to `contactId` as the local avatar.
 *
 * `transient` means the source was unreachable rather than wrong (throttling, 5xx, network): the
 * caller should leave the contact in the backlog rather than banking it as exhausted.
 */
export async function cacheAvatarFromUrl(
  contactId: string,
  url: string,
  fetchImpl: typeof fetch,
): Promise<AvatarCacheResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", signal: controller.signal });
  } catch (error) {
    return {
      status: "transient",
      message: error instanceof Error ? error.message : "Avatar fetch failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 || response.status >= 500) {
    return { status: "transient", message: `Avatar fetch returned ${response.status}` };
  }
  if (!response.ok) {
    return { status: "miss", reason: `Avatar fetch returned ${response.status}` };
  }

  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const extension = extensionFor(mimeType);
  if (!extension) {
    return { status: "miss", reason: `Unsupported avatar content-type: ${mimeType || "none"}` };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return {
      status: "transient",
      message: error instanceof Error ? error.message : "Avatar body read failed",
    };
  }

  if (buffer.byteLength === 0) {
    return { status: "miss", reason: "Avatar response was empty" };
  }
  if (buffer.byteLength > MAX_AVATAR_BYTES) {
    return { status: "miss", reason: `Avatar exceeded ${MAX_AVATAR_BYTES} bytes` };
  }

  const storagePath = `${nanoid()}${extension}`;
  mkdirSync(MEDIA_DIR, { recursive: true });
  writeFileSync(join(MEDIA_DIR, storagePath), buffer);

  const asset = createMediaAsset({
    filename: `avatar${extension}`,
    storagePath,
    mimeType,
    fileSize: buffer.byteLength,
    // Provenance, and what lets a later pass tell a cached remote avatar from an operator upload.
    origin: "platform_cache",
    sourceUrl: url,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    scope: "local_only",
  });

  createMediaAttachment({
    mediaAssetId: asset.id,
    parentType: "contact",
    parentId: contactId,
    role: "avatar",
  });

  return { status: "cached", mediaAssetId: asset.id, bytes: buffer.byteLength };
}
