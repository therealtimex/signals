import { describe, expect, it } from "vitest";
import { getContentRowActionKinds, getOpenPlatformLabel } from "./content-row-actions";

const base = {
  hasRetryPayload: false,
  hasThread: false,
  hasPlatformUrl: false,
  stale: false,
  hasJob: false,
};

describe("getContentRowActionKinds", () => {
  it.each([
    ["draft", { ...base }, ["edit"]],
    ["queued", { ...base, hasThread: true }, ["open-thread"]],
    ["publishing", { ...base, hasThread: true }, ["open-thread"]],
    ["published", { ...base, hasThread: true, hasPlatformUrl: true }, ["open-thread", "open-platform"]],
    ["imported", { ...base, hasPlatformUrl: true }, ["open-platform"]],
    ["failed", { ...base, hasRetryPayload: true, hasThread: true, hasJob: true }, ["retry", "open-thread", "mark-failed"]],
    ["published", { ...base, stale: true, hasJob: true }, ["mark-failed"]],
  ])("returns the %s action contract", (status, options, expected) => {
    expect(getContentRowActionKinds({ status, ...options })).toEqual(expected);
  });

  it("keeps the platform affordance independent from lifecycle status", () => {
    expect(
      getContentRowActionKinds({ status: "draft", ...base, hasPlatformUrl: true })
    ).toEqual(["edit", "open-platform"]);
  });
});

describe("getOpenPlatformLabel", () => {
  it("names the destination when known", () => {
    expect(getOpenPlatformLabel("X")).toBe("Open on X");
    expect(getOpenPlatformLabel(null)).toBe("Open on platform");
  });
});
