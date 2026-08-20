import { describe, expect, it } from "vitest";
import { buildPlatformSections } from "@/lib/analytics/platform-sections";
import type { PlatformEngagementAverages, TopPostRow } from "@/lib/db/queries/analytics";

function post(platform: string | null, title: string): TopPostRow {
  return {
    title,
    platform,
    platformUrl: null,
    likes: 1,
    comments: 1,
    shares: 1,
    retweets: 1,
    quotes: 1,
    impressions: 1,
    total: 6,
  };
}

function averages(platform: string | null): PlatformEngagementAverages {
  return {
    platform,
    snapshots: 1,
    avgLikes: 1,
    avgComments: 1,
    avgShares: 1,
    avgRetweets: 1,
    avgQuotes: 1,
    avgImpressions: 1,
  };
}

describe("buildPlatformSections", () => {
  it("groups posts and averages by platform", () => {
    const sections = buildPlatformSections(
      [post("x", "X one"), post("facebook", "FB one"), post("x", "X two")],
      [averages("x"), averages("facebook")]
    );

    expect(sections.map((section) => section.platform)).toEqual(["x", "facebook"]);
    expect(sections[0].posts.map((row) => row.title)).toEqual(["X one", "X two"]);
    expect(sections[0].metrics.map((metric) => metric.label)).toContain("Retweets");
    expect(sections[1].metrics.map((metric) => metric.label)).toContain("Shares");
    expect(sections[1].averages?.platform).toBe("facebook");
  });

  it("keeps a platform that only has averages, with no posts", () => {
    const sections = buildPlatformSections([], [averages("linkedin")]);

    expect(sections).toHaveLength(1);
    expect(sections[0].posts).toEqual([]);
    expect(sections[0].averages?.platform).toBe("linkedin");
  });

  it("keeps a platform that only has posts, with no averages", () => {
    const sections = buildPlatformSections([post("x", "X one")], []);

    expect(sections).toHaveLength(1);
    expect(sections[0].averages).toBeNull();
  });

  it("drops platforms that report no post engagement", () => {
    const sections = buildPlatformSections([post("gmail", "Mail")], [averages("gmail")]);

    expect(sections).toEqual([]);
  });

  it("keeps unattributed rows in their own section", () => {
    const sections = buildPlatformSections([post(null, "Orphan")], []);

    expect(sections.map((section) => section.platform)).toEqual([null]);
  });
});
