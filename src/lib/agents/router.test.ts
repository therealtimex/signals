import { describe, it, expect } from "vitest";
import { routeUrl, shouldEscalateToBrowser } from "@/lib/agents/router";

describe("routeUrl", () => {
  it("routes X to browser_scrape", () => {
    const decision = routeUrl("https://x.com/someuser");
    expect(decision.strategy).toBe("browser_scrape");
    expect(decision.reason).toMatch(/X\.com/i);
  });

  it("routes Wikipedia to url_fetch", () => {
    const decision = routeUrl("https://en.wikipedia.org/wiki/Signals");
    expect(decision.strategy).toBe("url_fetch");
  });

  it("defaults unknown domains to url_fetch", () => {
    const decision = routeUrl("https://example.com/page");
    expect(decision.strategy).toBe("url_fetch");
    expect(decision.reason).toMatch(/defaulting/i);
  });

  it("handles invalid URLs without throwing", () => {
    const decision = routeUrl("not-a-url");
    expect(decision.strategy).toBe("url_fetch");
  });
});

describe("shouldEscalateToBrowser", () => {
  it("escalates when content is very short", () => {
    expect(shouldEscalateToBrowser("hi", 2)).toBe(true);
  });

  it("escalates when javascript is required", () => {
    expect(
      shouldEscalateToBrowser("Please enable JavaScript to view this page.", 200)
    ).toBe(true);
  });

  it("does not escalate for normal HTML content", () => {
    const html =
      "<html><body><h1>Hello world</h1><p>Content here with enough text to exceed the minimum length threshold for escalation checks.</p></body></html>";
    expect(shouldEscalateToBrowser(html, html.length)).toBe(false);
  });
});
