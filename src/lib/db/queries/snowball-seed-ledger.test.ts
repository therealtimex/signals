import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { snowballSeedLedger } from "@/lib/db/schema";
import {
  SNOWBALL_SEED_CLAIM_TTL_MS,
  SNOWBALL_SEED_DEDUPE_WINDOW_MS,
  claimSeed,
  confirmSeed,
  findRecentlyQueuedSeedHashes,
  pruneSnowballSeedLedger,
  releaseSeedClaim,
} from "@/lib/db/queries/snowball-seed-ledger";
import { resetCoreTables } from "@/test/db";

/** Backdate a ledger row so window boundaries can be exercised without waiting. */
function ageSeed(urlHash: string, ageMs: number): void {
  const enqueuedAt = Math.floor((Date.now() - ageMs) / 1000);
  db.update(snowballSeedLedger)
    .set({ enqueuedAt })
    .where(eq(snowballSeedLedger.urlHash, urlHash))
    .run();
}

function seed(urlHash: string) {
  return { urlHash, url: `https://x.com/a/status/${urlHash}` };
}

describe("snowball seed ledger", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("grants a claim on a URL never seen before", () => {
    expect(claimSeed(seed("hash-a"))).toBe(true);
  });

  it("refuses a second concurrent claim on the same URL", () => {
    expect(claimSeed(seed("hash-race"))).toBe(true);
    // The competing run has not confirmed yet, but must still be locked out —
    // otherwise both POST and the calendar gets duplicate events.
    expect(claimSeed(seed("hash-race"))).toBe(false);
  });

  it("blocks a confirmed seed for the dedupe window", () => {
    claimSeed(seed("hash-done"));
    confirmSeed("hash-done", "evt-1");

    expect(claimSeed(seed("hash-done"))).toBe(false);
    expect(findRecentlyQueuedSeedHashes(["hash-done"])).toEqual(
      new Set(["hash-done"]),
    );
  });

  it("allows a confirmed seed past the dedupe window", () => {
    claimSeed(seed("hash-old"));
    confirmSeed("hash-old", "evt-2");
    ageSeed("hash-old", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(findRecentlyQueuedSeedHashes(["hash-old"]).size).toBe(0);
    expect(claimSeed(seed("hash-old"))).toBe(true);
  });

  it("reclaims a stale pending claim left by a crashed run", () => {
    claimSeed(seed("hash-stale"));
    ageSeed("hash-stale", SNOWBALL_SEED_CLAIM_TTL_MS + 60_000);

    // A crash between claim and confirm must not wedge the URL for a week.
    expect(claimSeed(seed("hash-stale"))).toBe(true);
    const rows = db
      .select()
      .from(snowballSeedLedger)
      .where(eq(snowballSeedLedger.urlHash, "hash-stale"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });

  it("keeps a fresh pending claim locked", () => {
    claimSeed(seed("hash-fresh"));
    ageSeed("hash-fresh", SNOWBALL_SEED_CLAIM_TTL_MS - 60_000);

    expect(claimSeed(seed("hash-fresh"))).toBe(false);
  });

  it("frees a released claim immediately", () => {
    claimSeed(seed("hash-fail"));
    releaseSeedClaim("hash-fail");

    expect(db.select().from(snowballSeedLedger).all()).toHaveLength(0);
    expect(claimSeed(seed("hash-fail"))).toBe(true);
  });

  it("does not release a confirmed seed", () => {
    claimSeed(seed("hash-safe"));
    confirmSeed("hash-safe", "evt-3");
    releaseSeedClaim("hash-safe");

    expect(db.select().from(snowballSeedLedger).all()).toHaveLength(1);
    expect(claimSeed(seed("hash-safe"))).toBe(false);
  });

  it("prunes only rows past the window", () => {
    claimSeed(seed("hash-keep"));
    confirmSeed("hash-keep", "evt-4");
    claimSeed(seed("hash-drop"));
    confirmSeed("hash-drop", "evt-5");
    ageSeed("hash-drop", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(pruneSnowballSeedLedger()).toBe(1);
    expect(db.select().from(snowballSeedLedger).all().map((r) => r.urlHash)).toEqual([
      "hash-keep",
    ]);
  });

  it("handles an empty lookup without querying", () => {
    expect(findRecentlyQueuedSeedHashes([]).size).toBe(0);
  });
});
