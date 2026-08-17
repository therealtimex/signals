import type { PublishResult } from "@/lib/browser/publishers/types";

/** Twitter snowflake epoch (2010-11-04 UTC). */
export const TWITTER_EPOCH_MS = 1288834974657;

export function normalizeTweetText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function extractStatusIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

export function statusIdToTimestampMs(statusId: string): number | null {
  try {
    const id = BigInt(statusId);
    return Number(id >> 22n) + TWITTER_EPOCH_MS;
  } catch {
    return null;
  }
}

export function maxStatusIdNumeric(statusIds: ReadonlySet<string>): bigint {
  let max = 0n;
  for (const id of statusIds) {
    try {
      const value = BigInt(id);
      if (value > max) max = value;
    } catch {
      // ignore non-numeric ids
    }
  }
  return max;
}

/** True when the status URL belongs to the logged-in handle (not a nested quote). */
export function isStatusOwnedByHandle(href: string, handle: string): boolean {
  const clean = handle.replace(/^@/, "").toLowerCase();
  try {
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const match = path.match(/^\/([^/]+)\/status\/(\d+)/);
    return match?.[1]?.toLowerCase() === clean;
  } catch {
    return false;
  }
}

export type ProfileStatusCandidate = {
  statusId: string;
  href: string;
  text: string;
};

/** Snapshot captured after the profile timeline is demonstrably loaded. */
export type ProfileStatusBaseline = {
  statusIds: ReadonlySet<string>;
  timelineReady: boolean;
  /** True when readiness polling reached a stable loaded timeline snapshot. */
  snapshotComplete: boolean;
  maxStatusId: bigint;
  /** True when readiness polling saw X's explicit empty-state marker. */
  confirmedEmpty: boolean;
  /** Wall-clock time when the stabilized owned-status snapshot was captured. */
  capturedAtMs: number;
};

/**
 * Build a stable signature for timeline readiness.
 * Uses all visible status-card links to detect loading; owned IDs are tracked separately.
 */
export function buildTimelineSnapshotSignature(
  articleCount: number,
  emptyVisible: boolean,
  statusLinkKeys: readonly string[],
  ownedCandidates: readonly ProfileStatusCandidate[]
): string | null {
  if (emptyVisible && articleCount === 0) return "empty";
  if (articleCount === 0 && !emptyVisible) return null;

  const scannedArticles = Math.min(articleCount, 12);
  if (scannedArticles > 0 && statusLinkKeys.length < scannedArticles) return null;

  const linkKeys = [...new Set(statusLinkKeys)].sort();
  const ownedIds = [...new Set(ownedCandidates.map((candidate) => candidate.statusId))].sort();
  return `${articleCount}|links:${linkKeys.join(",")}|owned:${ownedIds.join(",")}`;
}

/** @deprecated Use buildTimelineSnapshotSignature */
export const buildOwnedStatusSnapshotSignature = buildTimelineSnapshotSignature;

export function toPlatformUrl(href: string): string {
  return href.startsWith("http") ? href : `https://x.com${href}`;
}

export type SelectNewOwnedStatusOptions = Record<string, never>;

/**
 * Pick a newly published status owned by `handle` that matches `expectedText`,
 * was not present in the baseline, and was created after the baseline snapshot.
 */
export function selectNewOwnedStatus(
  candidates: ProfileStatusCandidate[],
  handle: string,
  expectedText: string,
  baseline: ProfileStatusBaseline,
  _options: SelectNewOwnedStatusOptions = {}
): PublishResult | null {
  if (!baseline.timelineReady) return null;
  if (!baseline.snapshotComplete) return null;

  const needle = normalizeTweetText(expectedText).slice(0, 80);
  if (!needle) return null;

  for (const candidate of candidates) {
    if (baseline.statusIds.has(candidate.statusId)) continue;

    let candidateId: bigint;
    try {
      candidateId = BigInt(candidate.statusId);
    } catch {
      continue;
    }
    if (candidateId <= baseline.maxStatusId) continue;

    if (!isStatusOwnedByHandle(candidate.href, handle)) continue;
    if (!normalizeTweetText(candidate.text).includes(needle)) continue;

    const createdAt = statusIdToTimestampMs(candidate.statusId);
    if (createdAt === null || createdAt < baseline.capturedAtMs) continue;

    return {
      success: true,
      platformPostId: candidate.statusId,
      platformUrl: toPlatformUrl(candidate.href),
    };
  }

  return null;
}
