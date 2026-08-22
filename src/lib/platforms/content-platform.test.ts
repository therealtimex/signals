import { describe, expect, it } from "vitest";
import { PLATFORMS } from "@/lib/db/platforms";
import {
  buildPlatformPostUrl,
  getEngagementMetrics,
  getPlatformLabel,
  parseEngagementSnapshot,
  platformFromPlatformUrl,
  resolveContentPlatform,
  resolveContentPostUrl,
} from "@/lib/platforms/content-platform";

describe("platformFromPlatformUrl", () => {
  it("maps known post hosts to platforms", () => {
    expect(platformFromPlatformUrl("https://x.com/i/status/1")).toBe("x");
    expect(platformFromPlatformUrl("https://twitter.com/acme/status/1")).toBe("x");
    expect(platformFromPlatformUrl("https://www.linkedin.com/feed/update/urn:li:share:1")).toBe(
      "linkedin"
    );
    expect(platformFromPlatformUrl("https://www.facebook.com/acme/posts/1")).toBe("facebook");
  });

  it("returns null for unknown or missing hosts", () => {
    expect(platformFromPlatformUrl("https://example.com/post/1")).toBeNull();
    expect(platformFromPlatformUrl(null)).toBeNull();
  });
});

describe("resolveContentPlatform", () => {
  it("prefers the account the post was published through", () => {
    const platform = resolveContentPlatform(
      { platformTarget: "x", post: { platformUrl: "https://x.com/i/status/1" } },
      "linkedin"
    );
    expect(platform).toBe("linkedin");
  });

  it("prefers the permalink host over a multi-platform draft target", () => {
    const platform = resolveContentPlatform({
      platformTarget: "x,linkedin",
      post: { platformUrl: "https://www.linkedin.com/feed/update/urn:li:share:1" },
    });
    expect(platform).toBe("linkedin");
  });

  it("falls back to the first draft target when there is no post", () => {
    expect(resolveContentPlatform({ platformTarget: " LinkedIn , x " })).toBe("linkedin");
  });

  it("returns null when nothing identifies the platform", () => {
    expect(resolveContentPlatform({ platformTarget: null, post: null })).toBeNull();
  });

  it("passes unrecognized targets through", () => {
    expect(resolveContentPlatform({ platformTarget: "mastodon" })).toBe("mastodon");
  });
});

describe("resolveContentPostUrl", () => {
  it("returns the stored URL when present", () => {
    expect(
      resolveContentPostUrl("x", {
        platformUrl: "https://x.com/acme/status/1",
        platformPostId: "1",
      })
    ).toBe("https://x.com/acme/status/1");
  });

  it("derives canonical URLs from platformPostId when platformUrl is missing", () => {
    expect(resolveContentPostUrl("x", { platformPostId: "123" })).toBe(
      "https://x.com/i/status/123"
    );
    expect(resolveContentPostUrl("linkedin", { platformPostId: "456" })).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:456"
    );
    expect(resolveContentPostUrl("facebook", { platformPostId: "789" })).toBe(
      "https://www.facebook.com/789"
    );
    expect(
      resolveContentPostUrl("facebook", {
        platformPostId: "https://www.facebook.com/acme/posts/789",
      })
    ).toBe("https://www.facebook.com/acme/posts/789");
  });

  it("returns null when nothing can be resolved", () => {
    expect(resolveContentPostUrl("x", null)).toBeNull();
    expect(resolveContentPostUrl("x", {})).toBeNull();
    expect(resolveContentPostUrl("gmail", { platformPostId: "789" })).toBeNull();
  });
});

describe("buildPlatformPostUrl", () => {
  it("builds known platform permalinks", () => {
    expect(buildPlatformPostUrl("x", "42")).toBe("https://x.com/i/status/42");
    expect(buildPlatformPostUrl("linkedin", "99")).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:99"
    );
    expect(buildPlatformPostUrl("facebook", "slug.post")).toBe(
      "https://www.facebook.com/slug.post"
    );
    expect(buildPlatformPostUrl("facebook", "https://www.facebook.com/acme/posts/1")).toBe(
      "https://www.facebook.com/acme/posts/1"
    );
  });
});

describe("getPlatformLabel", () => {
  it("uses the short platform label", () => {
    expect(getPlatformLabel("x")).toBe("X");
    expect(getPlatformLabel("linkedin")).toBe("LinkedIn");
    expect(getPlatformLabel("facebook")).toBe("Facebook");
  });

  it("falls back to the raw value, then to a generic noun", () => {
    expect(getPlatformLabel("mastodon")).toBe("mastodon");
    expect(getPlatformLabel(null)).toBe("Platform");
  });

  it("names every registered platform instead of echoing its id", () => {
    for (const platform of PLATFORMS) {
      expect(getPlatformLabel(platform)).not.toBe(platform);
    }
  });
});

describe("parseEngagementSnapshot", () => {
  it("parses object snapshots and rejects everything else", () => {
    expect(parseEngagementSnapshot('{"likes":3}')).toEqual({ likes: 3 });
    expect(parseEngagementSnapshot("not json")).toBeNull();
    expect(parseEngagementSnapshot("42")).toBeNull();
    expect(parseEngagementSnapshot(null)).toBeNull();
  });
});

describe("getEngagementMetrics", () => {
  const snapshot = { likes: 5, replies: 2, retweets: 1, quotes: 4, comments: 7, shares: 3 };

  it("shows X counters for X content", () => {
    expect(getEngagementMetrics("x", snapshot).map((m) => m.label)).toEqual([
      "Likes",
      "Replies",
      "Retweets",
      "Quotes",
    ]);
  });

  it("shows shares instead of retweets for other social platforms", () => {
    for (const platform of ["linkedin", "facebook", "instagram", "threads"]) {
      expect(getEngagementMetrics(platform, snapshot).map((m) => m.label)).toEqual([
        "Likes",
        "Comments",
        "Shares",
      ]);
    }
  });

  it("zero-fills declared counters the snapshot is missing", () => {
    expect(getEngagementMetrics("x", { likes: 5 })).toEqual([
      { key: "likes", label: "Likes", value: 5 },
      { key: "replies", label: "Replies", value: 0 },
      { key: "retweets", label: "Retweets", value: 0 },
      { key: "quotes", label: "Quotes", value: 0 },
    ]);
  });

  it("reports nothing for gmail or a missing snapshot", () => {
    expect(getEngagementMetrics("gmail", snapshot)).toEqual([]);
    expect(getEngagementMetrics("x", null)).toEqual([]);
  });

  it("falls back to the counters an unknown platform actually recorded", () => {
    expect(getEngagementMetrics("mastodon", { likes: 5, shares: 3 }).map((m) => m.key)).toEqual([
      "likes",
      "shares",
    ]);
    expect(getEngagementMetrics(null, { impressions: 9 })).toEqual([]);
  });
});
