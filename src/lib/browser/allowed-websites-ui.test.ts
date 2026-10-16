import { describe, expect, it } from "vitest";
import type { AddAllowedOriginResult, AllowedOriginsView } from "@/lib/browser/allowed-websites-types";
import {
  calloutOriginState,
  calloutRetryOutcome,
  cardAlert,
  formatAddedMeta,
  groupRecoverableDenials,
  interpretAdd,
  interpretApply,
  interpretRemove,
  interpretUndo,
  manageAllowedWebsitesHref,
  pickInitialConnection,
  rowNotActive,
} from "@/lib/browser/allowed-websites-ui";
import type { RunNavigationDenial } from "@/lib/browser/navigation-blocked";

const DEFAULTS = ["https://x.com", "https://www.linkedin.com", "https://lnkd.in", "https://www.facebook.com"];
const reachable = (allowedOrigins: string[], applied: boolean) => ({ reachable: true, allowedOrigins, applied });
const unreachable = { reachable: false, allowedOrigins: null, applied: null, error: "fetch failed" };

function added(overrides: Partial<AddAllowedOriginResult>): AddAllowedOriginResult {
  return {
    origin: "https://example.org",
    status: "added",
    persisted: true,
    applied: true,
    effective: [...DEFAULTS, "https://example.org"],
    runtime: reachable([...DEFAULTS, "https://example.org"], true),
    ...overrides,
  };
}

describe("Add results (contract §1.1)", () => {
  it.each([
    [{ status: 200, body: added({}) }, "Added https://example.org. The browser can open it now.", true],
    [
      { status: 502, body: added({ applied: false, runtime: reachable(DEFAULTS, false) }) },
      "Saved https://example.org, but it isn't active yet.",
      true,
    ],
    [
      { status: 502, body: added({ applied: false, runtime: unreachable }) },
      "Saved https://example.org. It takes effect when the RealTimeX Browser is available.",
      true,
    ],
    [{ status: 200, body: added({ origin: "https://x.com", status: "already_default" }) }, "https://x.com is already allowed by Signals.", true],
    [{ status: 200, body: added({ status: "already_added" }) }, "https://example.org is already in your list.", true],
  ] as const)("reports %j", (outcome, message, clearInput) => {
    expect(interpretAdd(outcome, "signals-publish")).toMatchObject({ kind: "result", message, clearInput });
  });

  it.each([
    [{ status: 400, body: { code: "invalid_url", error: "" } }, "Enter a full link that starts with https:// or http://."],
    [{ status: 400, body: { code: "unsupported_scheme", error: "" } }, "Only websites that start with https:// or http:// can be allowed."],
    [{ status: 400, body: { code: "credentials_not_allowed", error: "" } }, "Remove the username and password from the link, then add it again."],
    [{ status: 403, body: { code: "DEV_INSTANCE_GUARD" } }, "This development copy of Signals can't change signals-publish."],
    [{ status: null, body: null }, "Couldn't save. Signals didn't respond, so nothing was changed. Try again."],
    [{ status: 500, body: null }, "Couldn't save. Signals didn't respond, so nothing was changed. Try again."],
    [{ status: 502, body: null }, "Couldn't save. Signals didn't respond, so nothing was changed. Try again."],
  ] as const)("shows a field error for %j", (outcome, message) => {
    expect(interpretAdd(outcome, "signals-publish")).toEqual({ kind: "field_error", message });
  });
});

describe("Remove, Undo and Try again (contract §1.2–§1.3)", () => {
  const removed = (overrides: object) => ({
    origin: "https://example.org",
    removed: true,
    applied: true,
    effective: DEFAULTS,
    runtime: reachable(DEFAULTS, true),
    ...overrides,
  });

  it("says what was removed, and when it isn't active yet", () => {
    expect(interpretRemove({ status: 200, body: removed({}) }, "signals-publish")).toMatchObject({
      message: "Removed https://example.org.",
    });
    expect(
      interpretRemove({ status: 502, body: removed({ applied: false, runtime: reachable([...DEFAULTS, "https://example.org"], false) }) }, "signals-publish"),
    ).toMatchObject({ message: "Removed https://example.org, but the change isn't active yet." });
    expect(interpretRemove({ status: 403, body: null }, "signals-publish")).toEqual({
      kind: "error",
      message: "This development copy of Signals can't change signals-publish.",
    });
    expect(interpretRemove({ status: null, body: null }, "signals-publish")).toMatchObject({ kind: "error" });
  });

  it("says a website was added back on Undo", () => {
    expect(interpretUndo({ status: 200, body: added({}) }, "signals-publish")).toMatchObject({
      message: "Added https://example.org back.",
    });
  });

  it("reports the alert's Try again", () => {
    const change = { applied: true, effective: DEFAULTS, runtime: reachable(DEFAULTS, true) };
    expect(interpretApply({ status: 200, body: change }, "signals-publish")).toMatchObject({
      message: "All changes are active.",
    });
    expect(
      interpretApply({ status: 502, body: { ...change, applied: false, runtime: reachable([], false) } }, "signals-publish"),
    ).toMatchObject({ message: "Still not active. The RealTimeX Browser didn't accept the update." });
  });
});

describe("never claims active without RealTimeX (contract §1.3, Addendum A3)", () => {
  it("shows one card alert at a time", () => {
    const added = [...DEFAULTS, "https://example.org"];
    const card = (runtime: AllowedOriginsView["runtime"], effective = added) => ({ runtime, effective, defaults: DEFAULTS });
    const noList = { reachable: true, allowedOrigins: null, applied: null };

    expect(cardAlert(card(null))).toBeNull();
    expect(cardAlert(card(unreachable))).toBe("unreachable");
    expect(cardAlert(card(reachable(DEFAULTS, false)))).toBe("not_active");
    expect(cardAlert(card(reachable(added, true)))).toBeNull();
    // RealTimeX holds no list for the session: the user's websites aren't active, so keep Try again.
    expect(cardAlert(card(noList))).toBe("not_active");
    // …but with nothing added there is nothing for the user to apply.
    expect(cardAlert(card(noList, DEFAULTS))).toBeNull();
  });

  it("badges a row Not active yet only while RealTimeX is reachable", () => {
    expect(rowNotActive("https://example.org", reachable(DEFAULTS, false))).toBe(true);
    expect(rowNotActive("https://example.org", reachable([...DEFAULTS, "https://example.org"], true))).toBe(false);
    expect(rowNotActive("https://example.org", { reachable: true, allowedOrigins: null, applied: null })).toBe(true);
    expect(rowNotActive("https://example.org", unreachable)).toBe(false);
    expect(rowNotActive("https://example.org", null)).toBe(false);
  });

  it("shows Website allowed only when RealTimeX is reachable and holds the website", () => {
    const view = (runtime: AllowedOriginsView["runtime"], effective = [...DEFAULTS, "https://example.org"]): AllowedOriginsView => ({
      connectionId: "bc_1",
      sessionName: "signals-publish",
      defaults: DEFAULTS,
      custom: [],
      effective,
      runtime,
    });

    expect(calloutOriginState("https://example.org", view(reachable([...DEFAULTS, "https://example.org"], true)))).toBe("allowed");
    expect(calloutOriginState("https://example.org", view(reachable(DEFAULTS, false)))).toBe("not_active");
    expect(calloutOriginState("https://example.org", view(unreachable))).toBe("unreachable");
    expect(calloutOriginState("https://example.org", view(null))).toBe("unreachable");
    expect(calloutOriginState("https://example.org", view(reachable(DEFAULTS, true), DEFAULTS))).toBe("blocked");
    expect(calloutOriginState("https://example.org", null)).toBe("blocked");
    // An old lnkd.in denial reads as allowed once RealTimeX holds the new default.
    expect(calloutOriginState("https://lnkd.in", view(reachable(DEFAULTS, true), DEFAULTS))).toBe("allowed");
  });
});

describe("run page grouping (Addendum A1)", () => {
  const denial = (overrides: Partial<RunNavigationDenial>): RunNavigationDenial => ({
    code: "RTX_NAVIGATION_BLOCKED",
    reason: "guardrail-origin-not-allowed",
    action: null,
    sessionName: "signals-publish",
    connectionId: "bc_publish",
    deniedOrigin: "https://lnkd.in",
    requestedUrl: null,
    recoverable: true,
    recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: "https://lnkd.in" },
    sources: ["raw"],
    ...overrides,
  });

  it("groups recoverable denials per resolved connection and skips the rest", () => {
    const groups = groupRecoverableDenials([
      denial({}),
      denial({
        deniedOrigin: "https://www.eventbrite.com",
        requestedUrl: "https://www.eventbrite.com/e/1",
        recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: "https://www.eventbrite.com" },
      }),
      denial({
        sessionName: "brand-x",
        connectionId: "bc_brand",
        recovery: { kind: "allow_origin", connectionId: "bc_brand", origin: "https://lnkd.in" },
      }),
      denial({ sessionName: "signals-scout-1", connectionId: null, recoverable: false, recovery: null }),
    ]);

    expect(groups).toEqual([
      {
        connectionId: "bc_publish",
        sessionName: "signals-publish",
        origins: [
          { origin: "https://lnkd.in", requestedUrl: null },
          { origin: "https://www.eventbrite.com", requestedUrl: "https://www.eventbrite.com/e/1" },
        ],
      },
      { connectionId: "bc_brand", sessionName: "brand-x", origins: [{ origin: "https://lnkd.in", requestedUrl: null }] },
    ]);
  });

  it("links Manage allowed websites to the connection's card", () => {
    expect(manageAllowedWebsitesHref("bc_1")).toBe("/dashboard/settings?tab=platforms&connection=bc_1#allowed-websites");
  });
});

describe("Settings helpers", () => {
  it("opens on the deep-linked connection, else signals-publish, else the first", () => {
    const rows = [
      { id: "bc_brand", sessionName: "brand-x", kind: "dedicated" as const },
      { id: "bc_publish", sessionName: "signals-publish", kind: "shared" as const },
    ];
    expect(pickInitialConnection(rows, "bc_brand")?.id).toBe("bc_brand");
    expect(pickInitialConnection(rows, null)?.id).toBe("bc_publish");
    expect(pickInitialConnection(rows.slice(0, 1), "missing")?.id).toBe("bc_brand");
    expect(pickInitialConnection([], null)).toBeNull();
  });

  it("describes when and how a website was added", () => {
    const now = new Date(2026, 9, 16, 12);
    expect(formatAddedMeta(Math.floor(new Date(2026, 9, 16, 9).getTime() / 1000), "settings", now)).toBe("Added today");
    expect(formatAddedMeta(Math.floor(new Date(2026, 9, 14, 9).getTime() / 1000), "settings", now)).toBe("Added on Oct 14");
    expect(formatAddedMeta(Math.floor(new Date(2026, 9, 16, 9).getTime() / 1000), "recovery", now)).toBe(
      "Added today from a blocked run",
    );
  });
});

describe("callout Try again outcome (experience review r1)", () => {
  const ORIGIN = "https://example.org";
  const view = (runtime: AllowedOriginsView["runtime"], effective = [...DEFAULTS, ORIGIN]): AllowedOriginsView => ({
    connectionId: "bc_1",
    sessionName: "signals-publish",
    defaults: DEFAULTS,
    custom: [],
    effective,
    runtime,
  });

  it("moves focus to the callout and says the website is allowed", () => {
    expect(calloutRetryOutcome(ORIGIN, [ORIGIN], view(reachable([...DEFAULTS, ORIGIN], true)))).toEqual({
      message: "https://example.org is allowed. Start the workflow again to use the link.",
      focusCallout: true,
    });
  });

  it("says these websites are allowed once every row is", () => {
    const both = [...DEFAULTS, ORIGIN, "https://lu.ma"];
    expect(calloutRetryOutcome(ORIGIN, [ORIGIN, "https://lu.ma"], view(reachable(both, true), both))).toEqual({
      message: "These websites are allowed. Start the workflow again to use them.",
      focusCallout: true,
    });
  });

  it("keeps focus and says why when it still isn't active", () => {
    expect(calloutRetryOutcome(ORIGIN, [ORIGIN], view(reachable(DEFAULTS, false)))).toEqual({
      message: "Still not active. The RealTimeX Browser didn't accept the update.",
      focusCallout: false,
    });
    expect(calloutRetryOutcome(ORIGIN, [ORIGIN], view(unreachable))).toEqual({
      message: "The RealTimeX Browser still isn't responding.",
      focusCallout: false,
    });
  });
});
