import { describe, expect, it } from "vitest";
import {
  getAnalyticsMetrics,
  getAnalyticsSectionLabel,
} from "@/lib/analytics/platform-columns";

describe("getAnalyticsMetrics", () => {
  it("gives X its own counters and calls the comments column Replies", () => {
    expect(getAnalyticsMetrics("x")).toEqual([
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Replies" },
      { key: "retweets", label: "Retweets" },
      { key: "quotes", label: "Quotes" },
      { key: "impressions", label: "Views" },
    ]);
  });

  it("gives other social platforms shares instead of retweets and quotes", () => {
    for (const platform of ["linkedin", "facebook", "instagram", "threads", "bluesky"]) {
      const labels = getAnalyticsMetrics(platform).map((metric) => metric.label);
      expect(labels).toEqual(["Likes", "Comments", "Shares", "Views"]);
    }
  });

  it("reports no counters for platforms without post engagement", () => {
    expect(getAnalyticsMetrics("gmail")).toEqual([]);
  });

  it("falls back to platform-neutral counters for unknown platforms", () => {
    expect(getAnalyticsMetrics("mastodon").map((metric) => metric.key)).toEqual([
      "likes",
      "comments",
      "shares",
      "impressions",
    ]);
    expect(getAnalyticsMetrics(null).map((metric) => metric.key)).not.toContain("retweets");
  });
});

describe("getAnalyticsSectionLabel", () => {
  it("names the platform, or says so when there is none", () => {
    expect(getAnalyticsSectionLabel("x")).toBe("X");
    expect(getAnalyticsSectionLabel("facebook")).toBe("Facebook");
    expect(getAnalyticsSectionLabel(null)).toBe("Unattributed");
  });
});
