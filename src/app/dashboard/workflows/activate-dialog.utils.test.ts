import { describe, expect, it } from "vitest";
import {
  actingTargetLabel,
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

describe("actingTargetLabel", () => {
  it("renders platform, name, and handle", () => {
    expect(
      actingTargetLabel({ platform: "facebook", name: "Le Dang Trung", handle: "ledangtrung" }),
    ).toBe("Facebook: Le Dang Trung (ledangtrung)");
    expect(actingTargetLabel({ platform: "x", name: "Trung Le", handle: "@trung_rta" })).toBe(
      "X: Trung Le (@trung_rta)",
    );
  });

  it("omits an empty handle and keeps unknown platforms readable", () => {
    expect(actingTargetLabel({ platform: "linkedin", name: "Trung Le", handle: "  " })).toBe(
      "LinkedIn: Trung Le",
    );
    expect(actingTargetLabel({ platform: "threads", name: "Trung Le", handle: null })).toBe(
      "threads: Trung Le",
    );
  });
});
