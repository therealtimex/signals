import { describe, expect, it } from "vitest";
import { orgTabHref, parseOrgTab } from "./organization-tabs";

describe("company profile tab URLs", () => {
  it("defaults invalid and missing values to overview", () => {
    expect(parseOrgTab(undefined)).toBe("overview");
    expect(parseOrgTab("unknown")).toBe("overview");
  });

  it("preserves supported tabs in shareable URLs", () => {
    expect(parseOrgTab("signals")).toBe("signals");
    expect(orgTabHref("org-1", "activity")).toBe(
      "/dashboard/organizations/org-1?tab=activity",
    );
  });
});
