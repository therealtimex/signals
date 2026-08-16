import type { NewContact, NewContactIdentity, NewContentItem, NewContentPost } from "@/lib/db/types";
import type { ContactWriteExtras } from "@/lib/db/queries/contacts";
import { liftIdentityStatsFromPlatformData } from "@/lib/db/identity-stats";
import type { XUser, XTweet } from "@/lib/platforms/x/client";

/** Split a display name into firstName/lastName. */
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

/** Extract a clean website URL from X user entities or raw URL field. */
function extractWebsite(xUser: XUser): string | null {
  // X often wraps URLs in t.co — the raw url field may contain the expanded version
  if (xUser.url) return xUser.url;
  return null;
}

/** Map an X user profile to Signals contact fields. */
export function mapXUserToContact(xUser: XUser): Omit<NewContact, "id"> & ContactWriteExtras {
  const { firstName, lastName } = splitName(xUser.name);

  return {
    name: xUser.name,
    firstName,
    lastName,
    bio: xUser.description || null,
    location: xUser.location || null,
    website: extractWebsite(xUser),
    photoUrl: xUser.profile_image_url?.replace("_normal", "_400x400") || null,
    platform: "x" as const,
    platformUserId: xUser.id,
    profileUrl: `https://x.com/${xUser.username}`,
    avatarUrl: xUser.profile_image_url || null,
  };
}

/** Map an X user profile to a contactIdentity row. */
export function mapXUserToIdentity(
  xUser: XUser,
  contactId: string
): Omit<NewContactIdentity, "id"> {
  const now = Math.floor(Date.now() / 1000);
  const platformData = JSON.stringify({
    followersCount: xUser.public_metrics?.followers_count ?? 0,
    followingCount: xUser.public_metrics?.following_count ?? 0,
    tweetCount: xUser.public_metrics?.tweet_count ?? 0,
    listedCount: xUser.public_metrics?.listed_count ?? 0,
    verified: xUser.verified ?? false,
    createdAt: xUser.created_at ?? null,
  });

  const lifted = liftIdentityStatsFromPlatformData(platformData, { statsUpdatedAt: now });

  return {
    contactId,
    platform: "x" as const,
    platformUserId: xUser.id,
    platformHandle: `@${xUser.username}`,
    platformUrl: `https://x.com/${xUser.username}`,
    platformData,
    displayName: xUser.name,
    bio: xUser.description || null,
    avatarUrl: xUser.profile_image_url || null,
    location: xUser.location || null,
    websiteUrl: extractWebsite(xUser),
    isVerified: xUser.verified ?? false,
    followersCount: xUser.public_metrics?.followers_count ?? null,
    followingCount: xUser.public_metrics?.following_count ?? null,
    postsCount: xUser.public_metrics?.tweet_count ?? null,
    listedCount: xUser.public_metrics?.listed_count ?? null,
    platformCreatedAt: isoToUnix(xUser.created_at),
    statsUpdatedAt: now,
    ...lifted,
    isPrimary: 1,
    isActive: 1,
    lastSyncedAt: now,
  };
}

/** Fields to patch on an existing identity during sync (excludes immutable keys). */
export function xUserIdentitySyncPatch(
  xUser: XUser,
  contactId: string
): Partial<Omit<NewContactIdentity, "id" | "contactId" | "platform" | "platformUserId">> {
  const full = mapXUserToIdentity(xUser, contactId);
  const {
    contactId: _contactId,
    platform: _platform,
    platformUserId: _platformUserId,
    isPrimary: _isPrimary,
    isActive: _isActive,
    ...patch
  } = full;
  return patch;
}

/** Parse an ISO date string to unix epoch seconds. */
function isoToUnix(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Map an X tweet to a content_item row. */
export function mapXTweetToContentItem(
  tweet: XTweet,
  accountId: string,
  origin: "authored" | "received"
): Omit<NewContentItem, "id"> {
  const isReply = tweet.text.startsWith("@");
  return {
    body: tweet.text,
    contentType: isReply ? ("reply" as const) : ("post" as const),
    status: "imported" as const,
    origin,
    direction: origin === "authored" ? ("outbound" as const) : ("inbound" as const),
    platformAccountId: accountId,
    platformData: JSON.stringify({
      authorId: tweet.author_id,
      publicMetrics: tweet.public_metrics,
    }),
    createdAt: isoToUnix(tweet.created_at) ?? Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/** Map an X tweet to a content_post row (published platform instance). */
export function mapXTweetToContentPost(
  tweet: XTweet,
  accountId: string
): Omit<NewContentPost, "id" | "contentItemId"> {
  const metrics = tweet.public_metrics;
  return {
    platformAccountId: accountId,
    platformPostId: tweet.id,
    platformUrl: `https://x.com/i/status/${tweet.id}`,
    publishedAt: isoToUnix(tweet.created_at),
    status: "imported" as const,
    engagementSnapshot: JSON.stringify({
      likes: metrics?.like_count ?? 0,
      retweets: metrics?.retweet_count ?? 0,
      replies: metrics?.reply_count ?? 0,
      quotes: metrics?.quote_count ?? 0,
    }),
  };
}

/** Extract structured engagement metrics from a tweet. */
export function extractTweetMetrics(tweet: XTweet): {
  likes: number;
  comments: number;
  shares: number;
  retweets: number;
  quotes: number;
  bookmarks: number;
  impressions: number;
} {
  const m = tweet.public_metrics;
  return {
    likes: m?.like_count ?? 0,
    comments: m?.reply_count ?? 0,
    shares: m?.retweet_count ?? 0,
    retweets: m?.retweet_count ?? 0,
    quotes: m?.quote_count ?? 0,
    bookmarks: 0, // not available in basic tweet fields
    impressions: 0, // requires tweet.fields=non_public_metrics (oauth user context)
  };
}
