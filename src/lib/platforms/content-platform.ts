import { isPlatform, type Platform } from "@/lib/db/platforms";
import { PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";

/** Minimal content shape needed to tell which platform a content item belongs to. */
export interface ContentPlatformSource {
  platformTarget?: string | null;
  post?: { platformUrl?: string | null } | null;
}

const PLATFORM_HOSTS: ReadonlyArray<readonly [Platform, readonly string[]]> = [
  ["x", ["x.com", "twitter.com"]],
  ["linkedin", ["linkedin.com"]],
  ["gmail", ["mail.google.com"]],
  ["facebook", ["facebook.com", "fb.com"]],
  ["instagram", ["instagram.com"]],
  ["threads", ["threads.net", "threads.com"]],
  ["bluesky", ["bsky.app"]],
];

/** Platform implied by a post permalink, or null when the host is not recognized. */
export function platformFromPlatformUrl(url: string | null | undefined): Platform | null {
  if (!url) return null;
  let host: string | null = null;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = null;
  }
  const haystack = url.toLowerCase();
  for (const [platform, hosts] of PLATFORM_HOSTS) {
    const matches = hosts.some((candidate) =>
      host ? host === candidate || host.endsWith(`.${candidate}`) : haystack.includes(candidate)
    );
    if (matches) return platform;
  }
  return null;
}

/**
 * The platform a content item actually lives on.
 *
 * Ordered by authority: the connected account a post was published through, then the
 * permalink host, then the first entry of the (possibly multi-value) draft target.
 * Returns unrecognized targets as-is so callers can still label them.
 */
export function resolveContentPlatform(
  item: ContentPlatformSource,
  accountPlatform?: string | null
): string | null {
  if (accountPlatform) return accountPlatform.toLowerCase();

  const fromUrl = platformFromPlatformUrl(item.post?.platformUrl);
  if (fromUrl) return fromUrl;

  const target = item.platformTarget?.split(",")[0]?.trim().toLowerCase();
  return target || null;
}

/** Short platform name for UI copy; "Platform" when the platform is unknown. */
export function getPlatformLabel(platform: string | null | undefined): string {
  if (!platform) return "Platform";
  if (isPlatform(platform)) return PLATFORM_SHORT_LABELS[platform];
  return platform;
}

export type EngagementMetricKey =
  | "likes"
  | "replies"
  | "comments"
  | "retweets"
  | "quotes"
  | "shares";

export interface EngagementMetric {
  key: EngagementMetricKey;
  label: string;
  value: number;
}

const METRIC_LABELS: Record<EngagementMetricKey, string> = {
  likes: "Likes",
  replies: "Replies",
  comments: "Comments",
  retweets: "Retweets",
  quotes: "Quotes",
  shares: "Shares",
};

/** Canonical display order used when a platform has no declared metric set. */
const METRIC_ORDER: readonly EngagementMetricKey[] = [
  "likes",
  "replies",
  "comments",
  "retweets",
  "quotes",
  "shares",
];

const X_METRICS: readonly EngagementMetricKey[] = ["likes", "replies", "retweets", "quotes"];

/** Counters a platform reports when it declares nothing more specific. */
export const SOCIAL_METRIC_KEYS: readonly EngagementMetricKey[] = ["likes", "comments", "shares"];

const SOCIAL_METRICS = SOCIAL_METRIC_KEYS;

/** Metrics each platform reports. Platforms without post engagement map to an empty set. */
const PLATFORM_METRICS: Partial<Record<Platform, readonly EngagementMetricKey[]>> = {
  x: X_METRICS,
  linkedin: SOCIAL_METRICS,
  facebook: SOCIAL_METRICS,
  instagram: SOCIAL_METRICS,
  threads: SOCIAL_METRICS,
  bluesky: SOCIAL_METRICS,
  gmail: [],
};

/**
 * The counters a platform declares, with their labels, independent of any snapshot.
 *
 * Returns `undefined` for a platform with no declared set, so callers pick their own fallback:
 * the content views fall back to whatever the snapshot carries, analytics to the social set.
 * This is the single owner of the platform -> counter mapping; other surfaces derive from it.
 */
export function getEngagementMetricSpecs(
  platform: string | null | undefined
): { key: EngagementMetricKey; label: string }[] | undefined {
  const declared = platform && isPlatform(platform) ? PLATFORM_METRICS[platform] : undefined;
  if (!declared) return undefined;
  return declared.map((key) => ({ key, label: METRIC_LABELS[key] }));
}

/** Label for a counter key, so derived registries do not restate them. */
export function getEngagementMetricLabel(key: EngagementMetricKey): string {
  return METRIC_LABELS[key];
}

/** Engagement snapshot JSON as stored on a content post; null when absent or malformed. */
export function parseEngagementSnapshot(
  value: string | null | undefined
): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Engagement counters worth rendering for a platform.
 *
 * Known platforms get their own counters (zero-filled, so a fresh post still shows the
 * shape of its metrics). Unknown platforms fall back to whatever the snapshot actually
 * carries rather than inventing X-shaped zeros.
 */
export function getEngagementMetrics(
  platform: string | null | undefined,
  snapshot: Record<string, unknown> | null | undefined
): EngagementMetric[] {
  if (!snapshot) return [];

  const declared = platform && isPlatform(platform) ? PLATFORM_METRICS[platform] : undefined;
  const keys = declared ?? METRIC_ORDER.filter((key) => typeof snapshot[key] === "number");

  return keys.map((key) => ({
    key,
    label: METRIC_LABELS[key],
    value: typeof snapshot[key] === "number" ? (snapshot[key] as number) : 0,
  }));
}
