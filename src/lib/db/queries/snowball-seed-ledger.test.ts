import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { snowballSeedLedger } from "@/lib/db/schema";
import {
  SNOWBALL_SEED_CLAIM_TTL_MS,
  SNOWBALL_SEED_DEDUPE_WINDOW_MS,
  claimSeed,
  claimSeedWithSchedule,
  computeNextScheduledAtMs,
  confirmSeed,
  findRecentlyQueuedSeedHashes,
  getLatestReservedScheduledAtMs,
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
    expect(claimSeed(seed("hash-a"))).toEqual(expect.any(String));
  });

  it("refuses a second concurrent claim on the same URL", () => {
    expect(claimSeed(seed("hash-race"))).toEqual(expect.any(String));
    // The competing run has not confirmed yet, but must still be locked out —
    // otherwise both POST and the calendar gets duplicate events.
    expect(claimSeed(seed("hash-race"))).toBeNull();
  });

  it("blocks a confirmed seed for the dedupe window", () => {
    const token = claimSeed(seed("hash-done"))!;
    expect(confirmSeed("hash-done", token, "evt-1")).toBe(true);

    expect(claimSeed(seed("hash-done"))).toBeNull();
    expect(findRecentlyQueuedSeedHashes(["hash-done"])).toEqual(
      new Set(["hash-done"]),
    );
  });

  it("allows a confirmed seed past the dedupe window", () => {
    const token = claimSeed(seed("hash-old"))!;
    confirmSeed("hash-old", token, "evt-2");
    ageSeed("hash-old", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(findRecentlyQueuedSeedHashes(["hash-old"]).size).toBe(0);
    expect(claimSeed(seed("hash-old"))).toEqual(expect.any(String));
  });

  it("reclaims a stale pending claim left by a crashed run", () => {
    claimSeed(seed("hash-stale"));
    ageSeed("hash-stale", SNOWBALL_SEED_CLAIM_TTL_MS + 60_000);

    // A crash between claim and confirm must not wedge the URL for a week.
    expect(claimSeed(seed("hash-stale"))).toEqual(expect.any(String));
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

    expect(claimSeed(seed("hash-fresh"))).toBeNull();
  });

  it("frees a released claim immediately", () => {
    const token = claimSeed(seed("hash-fail"))!;
    expect(releaseSeedClaim("hash-fail", token)).toBe(true);

    expect(db.select().from(snowballSeedLedger).all()).toHaveLength(0);
    expect(claimSeed(seed("hash-fail"))).toEqual(expect.any(String));
  });

  it("does not release a confirmed seed", () => {
    const token = claimSeed(seed("hash-safe"))!;
    confirmSeed("hash-safe", token, "evt-3");
    expect(releaseSeedClaim("hash-safe", token)).toBe(false);

    expect(db.select().from(snowballSeedLedger).all()).toHaveLength(1);
    expect(claimSeed(seed("hash-safe"))).toBeNull();
  });

  it("prunes only rows past the window", () => {
    confirmSeed("hash-keep", claimSeed(seed("hash-keep"))!, "evt-4");
    confirmSeed("hash-drop", claimSeed(seed("hash-drop"))!, "evt-5");
    ageSeed("hash-drop", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(pruneSnowballSeedLedger()).toBe(1);
    expect(db.select().from(snowballSeedLedger).all().map((r) => r.urlHash)).toEqual([
      "hash-keep",
    ]);
  });

  it("stops a superseded owner from confirming the claim that replaced it", () => {
    const stale = claimSeed(seed("hash-fence"))!;
    ageSeed("hash-fence", SNOWBALL_SEED_CLAIM_TTL_MS + 60_000);
    const fresh = claimSeed(seed("hash-fence"))!;
    expect(fresh).not.toBe(stale);

    // The original run's POST finally returns. It must not stamp its result onto
    // the row that now belongs to the newer run.
    expect(confirmSeed("hash-fence", stale, "evt-stale")).toBe(false);

    const rows = db
      .select()
      .from(snowballSeedLedger)
      .where(eq(snowballSeedLedger.urlHash, "hash-fence"))
      .all();
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.calendarEventUuid).toBeNull();

    expect(confirmSeed("hash-fence", fresh, "evt-fresh")).toBe(true);
  });

  it("stops a superseded owner from releasing the claim that replaced it", () => {
    const stale = claimSeed(seed("hash-fence2"))!;
    ageSeed("hash-fence2", SNOWBALL_SEED_CLAIM_TTL_MS + 60_000);
    const fresh = claimSeed(seed("hash-fence2"))!;

    expect(releaseSeedClaim("hash-fence2", stale)).toBe(false);
    expect(db.select().from(snowballSeedLedger).all()).toHaveLength(1);
    expect(releaseSeedClaim("hash-fence2", fresh)).toBe(true);
  });

  it("handles an empty lookup without querying", () => {
    expect(findRecentlyQueuedSeedHashes([]).size).toBe(0);
  });

  it("returns the latest queued seed calendar start time", () => {
    const earlier = new Date("2026-01-01T10:00:00Z");
    const later = new Date("2026-01-01T11:00:00Z");
    confirmSeed(
      "hash-a",
      claimSeed(seed("hash-a"))!,
      "evt-a",
      earlier.toISOString(),
    );
    confirmSeed(
      "hash-b",
      claimSeed(seed("hash-b"))!,
      "evt-b",
      later.toISOString(),
    );

    expect(getLatestReservedScheduledAtMs()).toBe(later.getTime());
  });

  it("reserves the next slot atomically when claiming", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const first = claimSeedWithSchedule(seed("hash-a"), {
      saltMinMinutes: 10,
      saltMaxMinutes: 15,
    });
    const second = claimSeedWithSchedule(seed("hash-b"), {
      saltMinMinutes: 10,
      saltMaxMinutes: 15,
    });

    expect(first?.scheduledAtIso).toBe(new Date(now + 10 * 60_000).toISOString());
    expect(second?.scheduledAtIso).toBe(new Date(now + 20 * 60_000).toISOString());
    vi.restoreAllMocks();
  });

  it("computes the next slot from the previous reservation", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const now = 1_700_000_000_000;
    expect(computeNextScheduledAtMs(null, now, 10, 15)).toBe(now + 10 * 60_000);
    expect(computeNextScheduledAtMs(now - 20 * 60_000, now, 10, 15)).toBe(now);
    vi.restoreAllMocks();
  });
});
