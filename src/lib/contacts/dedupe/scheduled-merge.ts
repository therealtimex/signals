import { findDuplicateContacts } from "./detect";
import { runDedupeMerge, type RunDedupeMergeResult } from "./run-merge";

export const DEDUPE_MERGE_JOB_TYPE = "dedupe-merge";

/** Unattended sweeps stay small so a bad night cannot run away with the graph. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function readLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(numeric), 1), MAX_LIMIT);
}

/**
 * Cron-driven cleanup pass.
 *
 * Tier 1 only, and not configurable: a shared email or platform handle is the one signal
 * strong enough to act on with nobody watching. Tier 2 and 3 are inferred from names and
 * graph overlap, and merging is not reversible — those stay in the review panel where a
 * person confirms each group.
 *
 * Returns null when there is nothing to merge, so a quiet night leaves no empty run behind.
 */
export async function runScheduledDedupeMerge(
  payload: Record<string, unknown> = {}
): Promise<RunDedupeMergeResult | null> {
  const candidates = findDuplicateContacts({
    tiers: [1],
    minConfidence: 1,
    limit: readLimit(payload.limit),
  });
  if (candidates.length === 0) return null;

  return runDedupeMerge({
    templateId: typeof payload.templateId === "string" ? payload.templateId : undefined,
    groups: candidates.map((candidate) => ({
      primaryContactId: candidate.primaryContactId,
      secondaryContactIds: candidate.secondaryContactIds,
    })),
  });
}
