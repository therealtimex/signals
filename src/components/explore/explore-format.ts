import { PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";

export const platformLabels: Record<string, string> = { ...PLATFORM_SHORT_LABELS };

export function formatAccountAge(
  platformCreatedAt: number,
  platformLabel: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const days = Math.floor((now - platformCreatedAt) / 86_400);
  return `${days.toLocaleString()} days on ${platformLabel}`;
}

export function formatRelativeGeneratedAt(
  unixSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 1_209_600) return `${Math.floor(diff / 86_400)}d ago`;
  if (diff < 2_592_000) return `${Math.floor(diff / 604_800)}w ago`;
  if (diff < 31_536_000) return `${Math.floor(diff / 2_592_000)}mo ago`;
  return `${Math.floor(diff / 31_536_000)}y ago`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

export function hasAudienceMetrics(identity: {
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  listedCount?: number | null;
  engagementRate?: number | null;
}): boolean {
  return [
    identity.followersCount,
    identity.followingCount,
    identity.postsCount,
    identity.listedCount,
    identity.engagementRate,
  ].some((value) => value != null);
}

export function nichesBeyondInterests<T extends { name: string }>(
  niches: T[],
  interests: string[],
): T[] {
  const covered = new Set(interests.map((item) => item.trim().toLowerCase()));
  return niches.filter((niche) => !covered.has(niche.name.trim().toLowerCase()));
}
