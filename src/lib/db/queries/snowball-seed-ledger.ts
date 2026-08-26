import { and, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
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

export interface ClaimSeedWithScheduleOptions {
  saltMinMinutes: number;
  saltMaxMinutes: number;
  explicitScheduledAtIso?: string | null;
  windowMs?: number;
}

export interface ClaimSeedWithScheduleResult {
  claimToken: string;
  scheduledAtIso: string;
}

function randomSaltMinutes(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Next calendar start after `lastScheduledAtMs`, never before `nowMs`. */
export function computeNextScheduledAtMs(
  lastScheduledAtMs: number | null,
  nowMs: number,
  saltMinMinutes: number,
  saltMaxMinutes: number,
): number {
  const cursorMs = lastScheduledAtMs ?? nowMs;
  const delayMinutes = randomSaltMinutes(saltMinMinutes, saltMaxMinutes);
  return Math.max(nowMs, cursorMs + delayMinutes * 60_000);
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
 * The returned token is the row id, which doubles as a fencing token: a takeover
 * rotates it, so a superseded owner whose POST is still in flight can no longer
 * confirm or release the row that now belongs to someone else.
 *
 * @returns the claim token when this caller owns the claim, otherwise null.
 */
export function claimSeed(
  entry: SnowballSeedLedgerEntry,
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): string | null {
  const now = nowSeconds();
  const token = nanoid();
  const inserted = db
    .insert(snowballSeedLedger)
    .values({
      id: token,
      urlHash: entry.urlHash,
      url: entry.url,
      platform: entry.platform ?? null,
      producerRunId: entry.producerRunId ?? null,
      status: "pending",
      enqueuedAt: now,
    })
    .onConflictDoNothing({ target: snowballSeedLedger.urlHash })
    .run();

  if ((inserted.changes ?? 0) > 0) return token;

  // A row already exists. Take it over only when it is no longer live: a stale
  // claim, or a confirmed entry past the dedupe window.
  const takeover = db
    .update(snowballSeedLedger)
    .set({
      // Rotating the id invalidates the previous owner's token.
      id: token,
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

  return (takeover.changes ?? 0) > 0 ? token : null;
}

function reservedScheduleRow(
  now: number,
  windowMs: number,
  excludeUrlHash?: string,
) {
  const dedupeCutoff = now - Math.floor(windowMs / 1000);
  const claimCutoff = now - Math.floor(SNOWBALL_SEED_CLAIM_TTL_MS / 1000);
  const liveSchedule = or(
    and(
      eq(snowballSeedLedger.status, "queued"),
      gte(snowballSeedLedger.enqueuedAt, dedupeCutoff),
    ),
    and(
      eq(snowballSeedLedger.status, "pending"),
      gte(snowballSeedLedger.enqueuedAt, claimCutoff),
      isNotNull(snowballSeedLedger.scheduledAt),
    ),
  );

  return excludeUrlHash
    ? and(liveSchedule, ne(snowballSeedLedger.urlHash, excludeUrlHash))
    : liveSchedule;
}

/** Latest reserved calendar start among live queued or in-flight seeds. */
export function getLatestReservedScheduledAtMs(
  excludeUrlHash?: string,
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): number | null {
  const now = nowSeconds();
  const row = db
    .select({
      scheduledAtMs: sql<number>`max(coalesce(${snowballSeedLedger.scheduledAt}, ${snowballSeedLedger.enqueuedAt})) * 1000`,
    })
    .from(snowballSeedLedger)
    .where(reservedScheduleRow(now, windowMs, excludeUrlHash))
    .get();

  const scheduledAtMs = row?.scheduledAtMs;
  return scheduledAtMs != null && scheduledAtMs > 0 ? scheduledAtMs : null;
}

/**
 * Claim a URL and atomically reserve the next calendar slot in one transaction.
 *
 * Pending rows with `scheduled_at` count toward the cursor so overlapping runs
 * cannot schedule into the same minute before their POST completes.
 */
export function claimSeedWithSchedule(
  entry: SnowballSeedLedgerEntry,
  options: ClaimSeedWithScheduleOptions,
): ClaimSeedWithScheduleResult | null {
  const windowMs = options.windowMs ?? SNOWBALL_SEED_DEDUPE_WINDOW_MS;

  return db.transaction(() => {
    const claimToken = claimSeed(entry, windowMs);
    if (!claimToken) return null;

    let scheduledAtSec: number;
    if (options.explicitScheduledAtIso) {
      const parsed = new Date(options.explicitScheduledAtIso);
      if (!Number.isNaN(parsed.getTime())) {
        scheduledAtSec = Math.floor(parsed.getTime() / 1000);
      } else {
        const nowMs = Date.now();
        scheduledAtSec = Math.floor(
          computeNextScheduledAtMs(
            getLatestReservedScheduledAtMs(entry.urlHash, windowMs),
            nowMs,
            options.saltMinMinutes,
            options.saltMaxMinutes,
          ) / 1000,
        );
      }
    } else {
      const nowMs = Date.now();
      scheduledAtSec = Math.floor(
        computeNextScheduledAtMs(
          getLatestReservedScheduledAtMs(entry.urlHash, windowMs),
          nowMs,
          options.saltMinMinutes,
          options.saltMaxMinutes,
        ) / 1000,
      );
    }

    const updated = db
      .update(snowballSeedLedger)
      .set({ scheduledAt: scheduledAtSec, updatedAt: nowSeconds() })
      .where(
        and(
          eq(snowballSeedLedger.urlHash, entry.urlHash),
          eq(snowballSeedLedger.id, claimToken),
        ),
      )
      .run();

    if ((updated.changes ?? 0) === 0) return null;

    return {
      claimToken,
      scheduledAtIso: new Date(scheduledAtSec * 1000).toISOString(),
    };
  });
}

/**
 * @deprecated Use getLatestReservedScheduledAtMs — pending reservations count too.
 */
export function getLatestQueuedSeedScheduledAtMs(
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): number | null {
  return getLatestReservedScheduledAtMs(undefined, windowMs);
}

/**
 * Promote a claim to confirmed once the calendar has accepted the event.
 *
 * @returns false when the claim was taken over meanwhile, so this caller's
 * response no longer owns the row and must not overwrite it.
 */
export function confirmSeed(
  urlHash: string,
  claimToken: string,
  calendarEventUuid: string | null,
  scheduledAtIso?: string | null,
): boolean {
  const now = nowSeconds();
  const updates: {
    status: "queued";
    calendarEventUuid: string | null;
    enqueuedAt: number;
    updatedAt: number;
    scheduledAt?: number;
  } = {
    status: "queued",
    calendarEventUuid,
    enqueuedAt: now,
    updatedAt: now,
  };
  if (scheduledAtIso) {
    const parsed = new Date(scheduledAtIso);
    if (!Number.isNaN(parsed.getTime())) {
      updates.scheduledAt = Math.floor(parsed.getTime() / 1000);
    }
  }
  const result = db
    .update(snowballSeedLedger)
    .set(updates)
    .where(
      and(
        eq(snowballSeedLedger.urlHash, urlHash),
        eq(snowballSeedLedger.id, claimToken),
      ),
    )
    .run();
  return (result.changes ?? 0) > 0;
}

/**
 * Drop a claim whose calendar POST failed, so the seed stays retryable on the
 * next tick instead of being blocked for the full dedupe window.
 *
 * Scoped to the caller's own token so a superseded owner cannot delete the claim
 * that replaced it.
 *
 * @returns false when the row no longer belongs to this caller.
 */
export function releaseSeedClaim(urlHash: string, claimToken: string): boolean {
  const result = db
    .delete(snowballSeedLedger)
    .where(
      and(
        eq(snowballSeedLedger.urlHash, urlHash),
        eq(snowballSeedLedger.id, claimToken),
        eq(snowballSeedLedger.status, "pending"),
      ),
    )
    .run();
  return (result.changes ?? 0) > 0;
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
