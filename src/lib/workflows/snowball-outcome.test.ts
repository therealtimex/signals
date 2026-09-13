import { describe, expect, it } from "vitest";
import { getWorkflowOutcomeMetrics } from "@/lib/workflows/snowball-outcome";

const base = {
  config: null,
  result: null,
  successItems: 7,
  errorItems: 5,
};

describe("getWorkflowOutcomeMetrics", () => {
  it("preserves generic workflow counters", () => {
    expect(getWorkflowOutcomeMetrics(base)).toEqual({
      successValue: 7,
      errorValue: 5,
      successLabel: "Success",
      errorLabel: "Errors",
      isSnowball: false,
    });
  });

  it("separates Snowball committed contacts from audit violations", () => {
    expect(getWorkflowOutcomeMetrics({
      ...base,
      config: JSON.stringify({ networkSnowball: { version: 1 } }),
      result: JSON.stringify({
        snowballCandidates: { committed: 7 },
        identityEvidenceAudit: {
          violationCount: 2,
          violations: ["first", "second"],
        },
      }),
    })).toEqual({
      successValue: 7,
      errorValue: 2,
      successLabel: "Committed",
      errorLabel: "Audit violations",
      isSnowball: true,
    });
  });

  it("falls back to persisted counters for legacy Snowball runs", () => {
    expect(getWorkflowOutcomeMetrics({
      ...base,
      config: JSON.stringify({ networkSnowball: { version: 1 } }),
      result: "{}",
    })).toMatchObject({
      successValue: 7,
      errorValue: 5,
      successLabel: "Committed",
      errorLabel: "Audit violations",
    });
  });

  it("uses an empty additive violation list instead of a legacy error counter", () => {
    expect(getWorkflowOutcomeMetrics({
      ...base,
      config: JSON.stringify({ networkSnowball: { version: 1 } }),
      result: JSON.stringify({ identityEvidenceAudit: { violations: [] } }),
    })).toMatchObject({
      errorValue: 0,
      errorLabel: "Audit violations",
    });
  });
});
