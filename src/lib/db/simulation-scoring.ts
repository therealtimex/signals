import { ENGAGEMENT_METRIC_KEYS, assertEngagementScore } from "@/lib/db/simulation-validation";

export const SIMULATION_SCORING_RECIPE_VERSION = "engagement-v1";

export type EngagementMetricsRecord = Record<(typeof ENGAGEMENT_METRIC_KEYS)[number], number>;

export function emptyEngagementMetrics(): EngagementMetricsRecord {
  return {
    likes: 0,
    comments: 0,
    shares: 0,
    impressions: 0,
    clicks: 0,
    bookmarks: 0,
    quotes: 0,
    retweets: 0,
  };
}

export function sumEngagementMetrics(
  left: EngagementMetricsRecord,
  right: EngagementMetricsRecord,
): EngagementMetricsRecord {
  const result = emptyEngagementMetrics();
  for (const key of ENGAGEMENT_METRIC_KEYS) {
    result[key] = (left[key] ?? 0) + (right[key] ?? 0);
  }
  return result;
}

/** Shared recipe for predicted and actual Wind Tunnel scores (§7). */
export function scoreEngagementMetrics(metrics: EngagementMetricsRecord): number {
  const raw =
    metrics.likes * 2 +
    metrics.comments * 4 +
    metrics.shares * 5 +
    metrics.retweets * 5 +
    metrics.quotes * 4 +
    metrics.bookmarks * 3 +
    metrics.clicks * 3 +
    metrics.impressions * 0.05;
  return assertEngagementScore(Math.min(100, Math.round(raw)));
}
