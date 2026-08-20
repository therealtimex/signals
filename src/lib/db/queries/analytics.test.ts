import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contentPosts,
  engagementMetrics,
  platformAccounts,
} from "@/lib/db/schema";
import {
  getAverageEngagementMetrics,
  getTopPostsByEngagement,
} from "@/lib/db/queries/analytics";
import { resetCoreTables } from "@/test/db";

const NOW = 1_700_000_000;

function seedAccount(id: string, platform: "x" | "facebook") {
  db.insert(platformAccounts)
    .values({ id, platform, displayName: id, authType: "oauth" })
    .run();
}

function seedPost(
  id: string,
  accountId: string,
  title: string,
  metrics: Partial<{
    likes: number;
    comments: number;
    shares: number;
    retweets: number;
    quotes: number;
    impressions: number;
  }>,
  snapshotAt = NOW
) {
  db.insert(contentItems)
    .values({ id, title, contentType: "post", status: "published" })
    .run();
  db.insert(contentPosts)
    .values({ id: `${id}-post`, contentItemId: id, platformAccountId: accountId, status: "published" })
    .run();
  db.insert(engagementMetrics)
    .values({ id: `${id}-metric-${snapshotAt}`, contentPostId: `${id}-post`, snapshotAt, ...metrics })
    .run();
}

describe("analytics engagement queries", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    seedAccount("acct-x", "x");
    seedAccount("acct-fb", "facebook");
  });

  describe("getTopPostsByEngagement", () => {
    it("labels every row with the platform it was published through", () => {
      seedPost("x-1", "acct-x", "X post", { likes: 10, retweets: 5, quotes: 2 });
      seedPost("fb-1", "acct-fb", "Facebook post", { likes: 20, comments: 4, shares: 8 });

      const rows = getTopPostsByEngagement();

      expect(rows.map((row) => [row.platform, row.title])).toEqual(
        expect.arrayContaining([
          ["x", "X post"],
          ["facebook", "Facebook post"],
        ])
      );
      expect(rows.find((row) => row.platform === "x")).toMatchObject({ retweets: 5, quotes: 2 });
      expect(rows.find((row) => row.platform === "facebook")).toMatchObject({ shares: 8 });
    });

    it("totals exactly the counters each platform displays", () => {
      seedPost("x-1", "acct-x", "X post", {
        likes: 92,
        comments: 14,
        shares: 999, // X does not render shares, so it must not land in the total
        retweets: 27,
        quotes: 5,
        impressions: 4210,
      });
      seedPost("fb-1", "acct-fb", "Facebook post", {
        likes: 148,
        comments: 23,
        shares: 31,
        retweets: 999, // likewise, Facebook renders no retweets
        quotes: 999,
        impressions: 5120,
      });

      const rows = getTopPostsByEngagement();
      const x = rows.find((row) => row.platform === "x")!;
      const facebook = rows.find((row) => row.platform === "facebook")!;

      expect(x.total).toBe(92 + 14 + 27 + 5 + 4210);
      expect(facebook.total).toBe(148 + 23 + 31 + 5120);
    });

    it("applies the limit per platform, not across the whole result", () => {
      seedPost("x-1", "acct-x", "X high", { likes: 100 });
      seedPost("x-2", "acct-x", "X mid", { likes: 50 });
      seedPost("x-3", "acct-x", "X low", { likes: 1 });
      seedPost("fb-1", "acct-fb", "FB only", { likes: 2 });

      const rows = getTopPostsByEngagement(2);

      expect(rows.filter((row) => row.platform === "x").map((row) => row.title)).toEqual([
        "X high",
        "X mid",
      ]);
      expect(rows.filter((row) => row.platform === "facebook").map((row) => row.title)).toEqual([
        "FB only",
      ]);
    });

    it("reads the newest snapshot for each post", () => {
      seedPost("x-1", "acct-x", "X post", { likes: 3 }, NOW - 86_400);
      db.insert(engagementMetrics)
        .values({ id: "x-1-latest", contentPostId: "x-1-post", snapshotAt: NOW, likes: 99 })
        .run();

      expect(getTopPostsByEngagement()).toHaveLength(1);
      expect(getTopPostsByEngagement()[0]).toMatchObject({ likes: 99 });
    });
  });

  describe("getAverageEngagementMetrics", () => {
    it("averages each platform separately", () => {
      seedPost("x-1", "acct-x", "X one", { likes: 10, retweets: 4 });
      seedPost("x-2", "acct-x", "X two", { likes: 20, retweets: 6 });
      seedPost("fb-1", "acct-fb", "FB one", { likes: 100, shares: 30 });

      const rows = getAverageEngagementMetrics(NOW - 1);

      expect(rows.find((row) => row.platform === "x")).toMatchObject({
        snapshots: 2,
        avgLikes: 15,
        avgRetweets: 5,
      });
      expect(rows.find((row) => row.platform === "facebook")).toMatchObject({
        snapshots: 1,
        avgLikes: 100,
        avgShares: 30,
      });
    });

    it("ignores snapshots older than the range", () => {
      seedPost("x-1", "acct-x", "X old", { likes: 10 }, NOW - 86_400);

      expect(getAverageEngagementMetrics(NOW)).toEqual([]);
    });
  });
});
