import { Heart, ThumbsUp, type LucideIcon } from "lucide-react";

/** Platforms whose "like" is a thumbs-up rather than a heart. */
const THUMBS_UP_LIKE_PLATFORMS = new Set(["linkedin", "facebook"]);

/** Shared so every surface shows the same like icon for a platform. */
export function likeIcon(platform: string | null | undefined): LucideIcon {
  return platform && THUMBS_UP_LIKE_PLATFORMS.has(platform) ? ThumbsUp : Heart;
}
