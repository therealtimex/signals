import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { snowballSeedLedger } from "@/lib/db/schema";
import {
  SNOWBALL_SEED_DEDUPE_WINDOW_MS,
  findRecentlyQueuedSeedHashes,
  pruneSnowballSeedLedger,
  recordQueuedSeed,
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

describe("snowball seed ledger", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("reports a freshly queued seed as recently queued", () => {
    recordQueuedSeed({ urlHash: "hash-a", url: "https://x.com/a/status/1" });

    expect(findRecentlyQueuedSeedHashes(["hash-a"])).toEqual(new Set(["hash-a"]));
    expect(findRecentlyQueuedSeedHashes(["hash-b"]).size).toBe(0);
  });

  it("lets a seed past the dedupe window be queued again", () => {
    recordQueuedSeed({ urlHash: "hash-old", url: "https://x.com/a/status/2" });
    ageSeed("hash-old", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(findRecentlyQueuedSeedHashes(["hash-old"]).size).toBe(0);
  });

  it("keeps a seed inside the window blocked", () => {
    recordQueuedSeed({ urlHash: "hash-recent", url: "https://x.com/a/status/3" });
    ageSeed("hash-recent", SNOWBALL_SEED_DEDUPE_WINDOW_MS - 60_000);

    expect(findRecentlyQueuedSeedHashes(["hash-recent"])).toEqual(
      new Set(["hash-recent"]),
    );
  });

  it("refreshes rather than duplicating an existing hash", () => {
    recordQueuedSeed({ urlHash: "hash-dup", url: "https://x.com/a/status/4" });
    ageSeed("hash-dup", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);
    recordQueuedSeed({
      urlHash: "hash-dup",
      url: "https://x.com/a/status/4",
      calendarEventUuid: "evt-9",
    });

    const rows = db
      .select()
      .from(snowballSeedLedger)
      .where(eq(snowballSeedLedger.urlHash, "hash-dup"))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.calendarEventUuid).toBe("evt-9");
    // The refreshed timestamp blocks it again.
    expect(findRecentlyQueuedSeedHashes(["hash-dup"]).size).toBe(1);
  });

  it("prunes only rows past the window", () => {
    recordQueuedSeed({ urlHash: "hash-keep", url: "https://x.com/a/status/5" });
    recordQueuedSeed({ urlHash: "hash-drop", url: "https://x.com/a/status/6" });
    ageSeed("hash-drop", SNOWBALL_SEED_DEDUPE_WINDOW_MS + 60_000);

    expect(pruneSnowballSeedLedger()).toBe(1);
    const remaining = db.select().from(snowballSeedLedger).all();
    expect(remaining.map((row) => row.urlHash)).toEqual(["hash-keep"]);
  });

  it("handles an empty lookup without querying", () => {
    expect(findRecentlyQueuedSeedHashes([]).size).toBe(0);
  });
});
