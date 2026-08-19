import { describe, expect, it } from "vitest";
import {
  distributePhaseTimings,
  formatStepOffsetFromRunStart,
} from "@/lib/workflows/workflow-step-timing";

describe("formatStepOffsetFromRunStart", () => {
  it("formats sub-minute offsets in seconds", () => {
    expect(formatStepOffsetFromRunStart(1_000_045, 1_000_000)).toBe("+45s");
  });

  it("formats minute offsets with remaining seconds", () => {
    expect(formatStepOffsetFromRunStart(1_000_135, 1_000_000)).toBe("+2m 15s");
  });

  it("formats whole-minute offsets without trailing zero seconds", () => {
    expect(formatStepOffsetFromRunStart(1_000_120, 1_000_000)).toBe("+2m");
  });

  it("returns null when run start is unknown", () => {
    expect(formatStepOffsetFromRunStart(1_000_010, null)).toBeNull();
  });
});

describe("distributePhaseTimings", () => {
  it("spreads timings across the phase window", () => {
    const timings = distributePhaseTimings(4, 0, 400);
    expect(timings).toHaveLength(4);
    expect(timings[0]).toEqual({ durationMs: 100, completedAtMs: 100 });
    expect(timings[3]).toEqual({ durationMs: 100, completedAtMs: 400 });
  });

  it("returns an empty array for zero outcomes", () => {
    expect(distributePhaseTimings(0, 0, 1_000)).toEqual([]);
  });
});
