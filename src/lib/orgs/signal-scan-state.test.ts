import { describe, expect, it } from "vitest";
import { isOrgSignalScanStale } from "./signal-scan-state";

const now = 1_800_000_000;
const day = 86_400;

describe("company signal staleness", () => {
  it("does not mark an unfollowed company stale when it has never run", () => {
    expect(isOrgSignalScanStale(null, null, now)).toBe(false);
  });

  it("marks a followed company stale when it has never run", () => {
    expect(isOrgSignalScanStale(now - day, null, now)).toBe(true);
  });

  it("keeps a completed scan current at exactly seven days", () => {
    expect(isOrgSignalScanStale(now - 30 * day, now - 7 * day, now)).toBe(false);
  });

  it("marks a completed scan stale after eight days", () => {
    expect(isOrgSignalScanStale(now - 30 * day, now - 8 * day, now)).toBe(true);
  });
});
