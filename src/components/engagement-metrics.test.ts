import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngagementMetrics } from "@/components/engagement-metrics";

const snapshot = { likes: 5, replies: 2, retweets: 1, quotes: 4, comments: 7, shares: 3 };

describe("EngagementMetrics", () => {
  it("labels X content with X counters", () => {
    const html = renderToStaticMarkup(
      createElement(EngagementMetrics, { snapshot, platform: "x" })
    );

    expect(html).toContain('aria-label="Retweets: 1"');
    expect(html).toContain('aria-label="Quotes: 4"');
    expect(html).not.toContain("Shares");
  });

  it("labels non-X content without X vocabulary", () => {
    const html = renderToStaticMarkup(
      createElement(EngagementMetrics, { snapshot, platform: "facebook" })
    );

    expect(html).toContain('aria-label="Comments: 7"');
    expect(html).toContain('aria-label="Shares: 3"');
    expect(html).not.toContain("Retweets");
    expect(html).not.toContain("Quotes");
  });

  it("renders nothing when the platform has no post engagement", () => {
    expect(
      renderToStaticMarkup(createElement(EngagementMetrics, { snapshot, platform: "gmail" }))
    ).toBe("");
    expect(
      renderToStaticMarkup(createElement(EngagementMetrics, { snapshot: null, platform: "x" }))
    ).toBe("");
  });
});
