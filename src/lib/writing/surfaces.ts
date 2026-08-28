import type { Platform } from "@/lib/db/platforms";

export const SURFACE_IDS = [
  "x/post",
  "x/thread",
  "x/reply",
  "x/quote",
  "linkedin/post",
  "linkedin/comment",
  "facebook/post",
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
