import type { Platform } from "@/lib/db/platforms";

export const SURFACE_IDS = [
  "x/post",
  "x/thread",
  "x/reply",
  "x/quote",
  "x/direct_message",
  "linkedin/post",
  "linkedin/comment",
  "linkedin/direct_message",
  "facebook/post",
  "facebook/comment",
  "facebook/direct_message",
  "threads/post",
  "threads/thread",
  "instagram/caption",
  "instagram/carousel",
  "tiktok/caption",
  "tiktok/script",
  "youtube/title",
  "youtube/description",
  "youtube/community_post",
  "youtube/hook_script",
  "youtube/thumbnail_brief",
] as const;

export type SurfaceId = (typeof SURFACE_IDS)[number];

export function parseSurfaceId(value: unknown): SurfaceId | null {
  return typeof value === "string" && (SURFACE_IDS as readonly string[]).includes(value)
    ? (value as SurfaceId)
    : null;
}

export function surfaceForDraft(
  platform: Platform,
  contentType: "post" | "thread",
): SurfaceId | null {
  return parseSurfaceId(`${platform}/${contentType}`);
}

/**
 * Content type a surface materializes into.
 *
 * A reply, comment, or direct message is not a post: materializing one as `post` would let it
 * match `surfaceForDraft`, which is exactly the check the publish lane uses to decide an artifact
 * is a publishable original (`src/lib/publish/send-to-agent.ts`).
 */
export function contentTypeForSurface(surface: SurfaceId): "post" | "thread" | "reply" | "dm" {
  if (surface.endsWith("/thread")) return "thread";
  if (surface.endsWith("/reply") || surface.endsWith("/comment")) return "reply";
  if (surface.endsWith("/direct_message")) return "dm";
  return "post";
}
