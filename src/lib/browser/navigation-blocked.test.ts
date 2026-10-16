import { describe, expect, it } from "vitest";
import {
  navigationContextFor,
  parseNavigationDenial,
  type RunNavigationDenial,
} from "@/lib/browser/navigation-blocked";

describe("parseNavigationDenial", () => {
  it("reads the origin from RealTimeX's plain denial text", () => {
    expect(
      parseNavigationDenial("The RealTimeX Browser session does not allow https://lnkd.in."),
    ).toEqual({
      reason: "guardrail-origin-not-allowed",
      action: null,
      sessionName: null,
      deniedOrigin: "https://lnkd.in",
      requestedUrl: null,
    });
  });

  it("finds the denial inside a longer CLI error and normalizes a port origin", () => {
    expect(
      parseNavigationDenial(
        "start-browser-session failed: The RealTimeX Browser session does not allow http://127.0.0.1:8080. (503)",
      )?.deniedOrigin,
    ).toBe("http://127.0.0.1:8080");
  });

  it("reads the canonical RTX_NAVIGATION_BLOCKED form, including text after the JSON", () => {
    const raw = `RTX_NAVIGATION_BLOCKED:${JSON.stringify({
      code: "RTX_NAVIGATION_BLOCKED",
      reason: "guardrail-origin-not-allowed",
      action: "create-tab",
      sessionName: "brand-x",
      deniedOrigin: "https://www.eventbrite.com",
      requestedUrl: "https://www.eventbrite.com/e/123?aff=x",
    })} (seed 2 of 3)`;

    expect(parseNavigationDenial(raw)).toEqual({
      reason: "guardrail-origin-not-allowed",
      action: "create-tab",
      sessionName: "brand-x",
      deniedOrigin: "https://www.eventbrite.com",
      requestedUrl: "https://www.eventbrite.com/e/123?aff=x",
    });
  });

  it("ignores origin locks, blocks and unrelated errors", () => {
    expect(parseNavigationDenial("The RealTimeX Browser session is locked to https://x.com.")).toBeNull();
    expect(parseNavigationDenial("The RealTimeX Browser session blocks https://x.com.")).toBeNull();
    expect(
      parseNavigationDenial("The RealTimeX Browser session only allows specific origins."),
    ).toBeNull();
    expect(parseNavigationDenial("fetch failed")).toBeNull();
    expect(parseNavigationDenial("RTX_NAVIGATION_BLOCKED:{not json")).toBeNull();
  });
});

describe("navigationContextFor", () => {
  const denial: RunNavigationDenial = {
    code: "RTX_NAVIGATION_BLOCKED",
    reason: "guardrail-origin-not-allowed",
    action: null,
    sessionName: "signals-scout-1",
    connectionId: null,
    deniedOrigin: "https://lnkd.in",
    requestedUrl: null,
    recoverable: false,
    recovery: null,
    sources: ["The RealTimeX Browser session does not allow https://lnkd.in."],
  };

  it("names the session and whether Signals manages it, for the error it came from", () => {
    expect(navigationContextFor(denial.sources[0], [denial])).toEqual({
      navigation: { sessionName: "signals-scout-1", managed: false },
    });
    expect(navigationContextFor("other error", [denial])).toBeUndefined();
    expect(navigationContextFor(denial.sources[0], undefined)).toBeUndefined();
  });
});
