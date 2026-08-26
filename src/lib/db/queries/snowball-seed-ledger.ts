import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { snowballSeedLedger } from "@/lib/db/schema";

/**
 * How long a queued post URL blocks a re-queue.
 *
 * The scout has no memory across heartbeat ticks, and a post that matched the
 * intent keywords once will keep matching while it stays in the feed. Re-running
 * Network Snowball on a post already scouted yields the same contact graph, so
 * the window is deliberately longer than RTX's 24h calendar dedupe.
 */
export const SNOWBALL_SEED_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long an unconfirmed claim blocks a retry.
 *
 * A `pending` row means some run is mid-POST. If that process dies before it can
 * confirm or release, the claim must not wedge the URL for the full dedupe
 * window — this bounds it to a little over the scout's 900s heartbeat timeout.
 */
export const SNOWBALL_SEED_CLAIM_TTL_MS = 20 * 60 * 1000;

export interface SnowballSeedLedgerEntry {
  urlHash: string;
  url: string;
  platform?: string | null;
  producerRunId?: string | null;
}

/** Unix seconds, matching the rest of the schema's time columns. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Rows a previous run has already dealt with: confirmed on the calendar inside
 * the dedupe window, or claimed by a run still in flight.
 */
function liveLedgerRow(now: number, windowMs: number) {
  return or(
    and(
      eq(snowballSeedLedger.status, "queued"),
      gte(snowballSeedLedger.enqueuedAt, now - Math.floor(windowMs / 1000)),
    ),
    and(
      eq(snowballSeedLedger.status, "pending"),
      gte(
        snowballSeedLedger.enqueuedAt,
        now - Math.floor(SNOWBALL_SEED_CLAIM_TTL_MS / 1000),
      ),
    ),
  );
}

/** Return the subset of `urlHashes` that must not be queued again right now. */
export function findRecentlyQueuedSeedHashes(
  urlHashes: string[],
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): Set<string> {
  const unique = [...new Set(urlHashes.filter(Boolean))];
  if (unique.length === 0) return new Set();

  const rows = db
    .select({ urlHash: snowballSeedLedger.urlHash })
    .from(snowballSeedLedger)
    .where(
      and(
        inArray(snowballSeedLedger.urlHash, unique),
        liveLedgerRow(nowSeconds(), windowMs),
      ),
    )
    .all();

  return new Set(rows.map((row) => row.urlHash));
}

/**
 * Atomically claim a URL before the calendar POST.
 *
 * The unique index on `url_hash` is the lock: two concurrent runs cannot both
 * insert, so exactly one wins and the loser treats the seed as already handled.
 * A stale `pending` row left by a crashed run is taken over rather than blocking
 * the URL for the full dedupe window.
 *
 * @returns true when this caller owns the claim and should POST.
 */
export function claimSeed(
  entry: SnowballSeedLedgerEntry,
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): boolean {
  const now = nowSeconds();
  const inserted = db
    .insert(snowballSeedLedger)
    .values({
      id: nanoid(),
      urlHash: entry.urlHash,
      url: entry.url,
      platform: entry.platform ?? null,
      producerRunId: entry.producerRunId ?? null,
      status: "pending",
      enqueuedAt: now,
    })
    .onConflictDoNothing({ target: snowballSeedLedger.urlHash })
    .run();

  if ((inserted.changes ?? 0) > 0) return true;

  // A row already exists. Take it over only when it is no longer live: a stale
  // claim, or a confirmed entry past the dedupe window.
  const takeover = db
    .update(snowballSeedLedger)
    .set({
      url: entry.url,
      platform: entry.platform ?? null,
      producerRunId: entry.producerRunId ?? null,
      calendarEventUuid: null,
      status: "pending",
      enqueuedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(snowballSeedLedger.urlHash, entry.urlHash),
        or(
          and(
            eq(snowballSeedLedger.status, "pending"),
            lt(
              snowballSeedLedger.enqueuedAt,
              now - Math.floor(SNOWBALL_SEED_CLAIM_TTL_MS / 1000),
            ),
          ),
          and(
            eq(snowballSeedLedger.status, "queued"),
            lt(snowballSeedLedger.enqueuedAt, now - Math.floor(windowMs / 1000)),
          ),
        ),
      ),
    )
    .run();

  return (takeover.changes ?? 0) > 0;
}

/** Promote a claim to confirmed once the calendar has accepted the event. */
export function confirmSeed(
  urlHash: string,
  calendarEventUuid: string | null,
): void {
  const now = nowSeconds();
  db.update(snowballSeedLedger)
    .set({ status: "queued", calendarEventUuid, enqueuedAt: now, updatedAt: now })
    .where(eq(snowballSeedLedger.urlHash, urlHash))
    .run();
}

/**
 * Drop a claim whose calendar POST failed, so the seed stays retryable on the
 * next tick instead of being blocked for the full dedupe window.
 */
export function releaseSeedClaim(urlHash: string): void {
  db.delete(snowballSeedLedger)
    .where(
      and(
        eq(snowballSeedLedger.urlHash, urlHash),
        eq(snowballSeedLedger.status, "pending"),
      ),
    )
    .run();
}

/** Drop ledger rows past the dedupe window so the table stays bounded. */
export function pruneSnowballSeedLedger(
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): number {
  const cutoff = nowSeconds() - Math.floor(windowMs / 1000);
  const result = db
    .delete(snowballSeedLedger)
    .where(lt(snowballSeedLedger.enqueuedAt, cutoff))
    .run();
  return result.changes ?? 0;
}
