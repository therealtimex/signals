import { getAnalyticsMetrics, type AnalyticsMetric } from "@/lib/analytics/platform-columns";
import type { PlatformEngagementAverages, TopPostRow } from "@/lib/db/queries/analytics";

export type PlatformSection = {
  platform: string | null;
  metrics: readonly AnalyticsMetric[];
  posts: TopPostRow[];
  averages: PlatformEngagementAverages | null;
};

/** One section per platform that has either ranked posts or averages worth showing. */
export function buildPlatformSections(
  topPosts: TopPostRow[],
  averages: PlatformEngagementAverages[]
): PlatformSection[] {
  const postsByPlatform = new Map<string | null, TopPostRow[]>();
  for (const row of topPosts) {
    const bucket = postsByPlatform.get(row.platform);
    if (bucket) bucket.push(row);
    else postsByPlatform.set(row.platform, [row]);
  }

  const averagesByPlatform = new Map<string | null, PlatformEngagementAverages>();
  for (const row of averages) averagesByPlatform.set(row.platform, row);

  const platforms: (string | null)[] = [...postsByPlatform.keys()];
  for (const platform of averagesByPlatform.keys()) {
    if (!postsByPlatform.has(platform)) platforms.push(platform);
  }

  const sections: PlatformSection[] = [];
  for (const platform of platforms) {
    const metrics = getAnalyticsMetrics(platform);
    if (metrics.length === 0) continue;
    sections.push({
      platform,
      metrics,
      posts: postsByPlatform.get(platform) ?? [],
      averages: averagesByPlatform.get(platform) ?? null,
    });
  }
  return sections;
}
