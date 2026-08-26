import { inArray, lt } from "drizzle-orm";
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

export interface SnowballSeedLedgerEntry {
  urlHash: string;
  url: string;
  platform?: string | null;
  calendarEventUuid?: string | null;
  producerRunId?: string | null;
}

/** Unix seconds, matching the rest of the schema's time columns. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Return the subset of `urlHashes` queued within the dedupe window.
 */
export function findRecentlyQueuedSeedHashes(
  urlHashes: string[],
  windowMs: number = SNOWBALL_SEED_DEDUPE_WINDOW_MS,
): Set<string> {
  const unique = [...new Set(urlHashes.filter(Boolean))];
  if (unique.length === 0) return new Set();

  const cutoff = nowSeconds() - Math.floor(windowMs / 1000);
  const rows = db
    .select({
      urlHash: snowballSeedLedger.urlHash,
      enqueuedAt: snowballSeedLedger.enqueuedAt,
    })
    .from(snowballSeedLedger)
    .where(inArray(snowballSeedLedger.urlHash, unique))
    .all();

  return new Set(
    rows.filter((row) => row.enqueuedAt >= cutoff).map((row) => row.urlHash),
  );
}

/**
 * Record a seed as queued. Idempotent: a duplicate hash refreshes the row
 * rather than failing the enqueue that already succeeded.
 */
export function recordQueuedSeed(entry: SnowballSeedLedgerEntry): void {
  const enqueuedAt = nowSeconds();
  db.insert(snowballSeedLedger)
    .values({
      id: nanoid(),
      urlHash: entry.urlHash,
      url: entry.url,
      platform: entry.platform ?? null,
      calendarEventUuid: entry.calendarEventUuid ?? null,
      producerRunId: entry.producerRunId ?? null,
      enqueuedAt,
    })
    .onConflictDoUpdate({
      target: snowballSeedLedger.urlHash,
      set: {
        enqueuedAt,
        url: entry.url,
        platform: entry.platform ?? null,
        calendarEventUuid: entry.calendarEventUuid ?? null,
        producerRunId: entry.producerRunId ?? null,
        updatedAt: enqueuedAt,
      },
    })
    .run();
}

/** Drop ledger rows older than the dedupe window so the table stays bounded. */
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
