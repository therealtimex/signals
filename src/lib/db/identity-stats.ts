import type { NewContactIdentity } from "@/lib/db/types";

type IdentityStatFields = Pick<
  NewContactIdentity,
  | "displayName"
  | "bio"
  | "avatarUrl"
  | "location"
  | "websiteUrl"
  | "isVerified"
  | "followersCount"
  | "followingCount"
  | "postsCount"
  | "listedCount"
  | "platformCreatedAt"
  | "statsUpdatedAt"
>;

export type IdentityStatsLiftInput = {
  platformData?: string | null;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  isVerified?: boolean | null;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  listedCount?: number | null;
  platformCreatedAt?: number | null;
  statsUpdatedAt?: number | null;
  lastSyncedAt?: number | null;
};

function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function readString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function readBoolean(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return undefined;
}

function readUnixTimestamp(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e12 ? Math.floor(value / 1000) : value;
    }
    if (typeof value === "string") {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
    }
  }
  return undefined;
}

/** Lift explore-card stat fields from `platform_data` JSON (idempotent projection). */
export function liftIdentityStatsFromPlatformData(
  platformData: string | null | undefined,
  opts?: { statsUpdatedAt?: number },
): Partial<IdentityStatFields> {
  if (!platformData) return {};

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(platformData) as Record<string, unknown>;
  } catch {
    return {};
  }

  const stats: Partial<IdentityStatFields> = {};

  const displayName = readString(parsed, ["displayName", "display_name", "name"]);
  if (displayName) stats.displayName = displayName;

  const bio = readString(parsed, ["bio", "description"]);
  if (bio) stats.bio = bio;

  const avatarUrl = readString(parsed, ["avatarUrl", "avatar_url", "profile_image_url"]);
  if (avatarUrl) stats.avatarUrl = avatarUrl;

  const location = readString(parsed, ["location"]);
  if (location) stats.location = location;

  const websiteUrl = readString(parsed, ["websiteUrl", "website_url", "url", "website"]);
  if (websiteUrl) stats.websiteUrl = websiteUrl;

  const isVerified = readBoolean(parsed, ["isVerified", "verified", "is_verified"]);
  if (isVerified !== undefined) stats.isVerified = isVerified;

  const followersCount = readNumber(parsed, ["followersCount", "followers_count"]);
  if (followersCount !== undefined) stats.followersCount = followersCount;

  const followingCount = readNumber(parsed, ["followingCount", "following_count"]);
  if (followingCount !== undefined) stats.followingCount = followingCount;

  const postsCount = readNumber(parsed, [
    "postsCount",
    "posts_count",
    "tweetCount",
    "tweet_count",
    "post_count",
  ]);
  if (postsCount !== undefined) stats.postsCount = postsCount;

  const listedCount = readNumber(parsed, ["listedCount", "listed_count"]);
  if (listedCount !== undefined) stats.listedCount = listedCount;

  const platformCreatedAt = readUnixTimestamp(parsed, [
    "platformCreatedAt",
    "platform_created_at",
    "createdAt",
    "created_at",
  ]);
  if (platformCreatedAt !== undefined) stats.platformCreatedAt = platformCreatedAt;

  if (Object.keys(stats).length > 0) {
    stats.statsUpdatedAt = opts?.statsUpdatedAt ?? Math.floor(Date.now() / 1000);
  }

  return stats;
}
