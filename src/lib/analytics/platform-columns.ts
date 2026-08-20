import {
  getEngagementMetricLabel,
  getEngagementMetricSpecs,
  getPlatformLabel,
  SOCIAL_METRIC_KEYS,
  type EngagementMetricKey,
} from "@/lib/platforms/content-platform";

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

/**
 * Snapshot key -> `engagement_metrics` column.
 *
 * X replies are stored in the `comments` column, which is why the analytics key and its label
 * ("Replies") differ for X — the label still comes from the snapshot key it derives from.
 */
const COLUMN_BY_METRIC_KEY: Record<EngagementMetricKey, AnalyticsMetricKey> = {
  likes: "likes",
  replies: "comments",
  comments: "comments",
  retweets: "retweets",
  quotes: "quotes",
  shares: "shares",
};

const VIEWS: AnalyticsMetric = { key: "impressions", label: "Views" };

function toAnalyticsMetric(key: EngagementMetricKey): AnalyticsMetric {
  return { key: COLUMN_BY_METRIC_KEY[key], label: getEngagementMetricLabel(key) };
}

/**
 * Counters worth showing for a platform, in display order.
 *
 * Derived from the registry in `content-platform.ts` so the analytics tab and the content views
 * cannot drift apart — analytics only adds `impressions`, which is not part of a post snapshot.
 * Empty means the platform reports no post engagement and deserves no section at all.
 */
export function getAnalyticsMetrics(
  platform: string | null | undefined
): readonly AnalyticsMetric[] {
  const specs = getEngagementMetricSpecs(platform);
  if (specs && specs.length === 0) return [];
  const keys = specs ? specs.map((spec) => spec.key) : SOCIAL_METRIC_KEYS;
  return [...keys.map(toAnalyticsMetric), VIEWS];
}

/** Section heading for a platform; posts with no resolvable account group under "Unattributed". */
export function getAnalyticsSectionLabel(platform: string | null | undefined): string {
  return platform ? getPlatformLabel(platform) : "Unattributed";
}
