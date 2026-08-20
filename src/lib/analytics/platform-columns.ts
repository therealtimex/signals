import { isPlatform, type Platform } from "@/lib/db/platforms";
import { getPlatformLabel } from "@/lib/platforms/content-platform";

/** `engagement_metrics` columns analytics can roll up. */
export type AnalyticsMetricKey =
  | "likes"
  | "comments"
  | "shares"
  | "retweets"
  | "quotes"
  | "impressions";

export interface AnalyticsMetric {
  key: AnalyticsMetricKey;
  label: string;
}

/** X replies are stored in the `comments` column, so the key and the label differ here. */
const X_METRICS: readonly AnalyticsMetric[] = [
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Replies" },
  { key: "retweets", label: "Retweets" },
  { key: "quotes", label: "Quotes" },
  { key: "impressions", label: "Views" },
];

const SOCIAL_METRICS: readonly AnalyticsMetric[] = [
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "impressions", label: "Views" },
];

const PLATFORM_METRICS: Partial<Record<Platform, readonly AnalyticsMetric[]>> = {
  x: X_METRICS,
  linkedin: SOCIAL_METRICS,
  facebook: SOCIAL_METRICS,
  instagram: SOCIAL_METRICS,
  threads: SOCIAL_METRICS,
  bluesky: SOCIAL_METRICS,
  gmail: [],
};

/**
 * Counters worth showing for a platform, in display order.
 *
 * Empty means the platform reports no post engagement and deserves no section at all — rendering
 * an all-zero "Retweets" column under a Facebook account reads as a data bug, which is the whole
 * point of grouping analytics per platform.
 */
export function getAnalyticsMetrics(
  platform: string | null | undefined
): readonly AnalyticsMetric[] {
  if (platform && isPlatform(platform)) return PLATFORM_METRICS[platform] ?? SOCIAL_METRICS;
  return SOCIAL_METRICS;
}

/** Section heading for a platform; posts with no resolvable account group under "Unattributed". */
export function getAnalyticsSectionLabel(platform: string | null | undefined): string {
  return platform ? getPlatformLabel(platform) : "Unattributed";
}
