import { describe, expect, it } from "vitest";
import {
  clampPipelineBatchSize,
  readRunLimitFromTemplateConfig,
} from "@/app/dashboard/workflows/activate-dialog.utils";

describe("clampPipelineBatchSize", () => {
  it("clamps to backlog total and max batch cap", () => {
    expect(clampPipelineBatchSize(45, 1783)).toBe(45);
    expect(clampPipelineBatchSize(99, 1783)).toBe(50);
    expect(clampPipelineBatchSize(10, 5)).toBe(5);
    expect(clampPipelineBatchSize(0, 100)).toBe(1);
  });
});

describe("readRunLimitFromTemplateConfig", () => {
  it("uses template values when present", () => {
    expect(
      readRunLimitFromTemplateConfig({
        maxResults: 42,
        maxContacts: 7,
        maxEnrichmentScore: 33,
      }),
    ).toEqual({
      maxResults: "42",
      maxContacts: "7",
      maxEnrichmentScore: "33",
      companyName: "",
      inactivityDays: "365",
      topics: "",
      tone: "professional",
      maxEngagements: "10",
    });
  });

  it("falls back to workflow defaults when fields are missing", () => {
    expect(readRunLimitFromTemplateConfig({})).toEqual({
      maxResults: "20",
      maxContacts: "10",
      maxEnrichmentScore: "50",
      companyName: "",
      inactivityDays: "365",
      topics: "",
      tone: "professional",
      maxEngagements: "10",
    });
  });
});
