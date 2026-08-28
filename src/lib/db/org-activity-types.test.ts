import { describe, expect, it } from "vitest";
import { assertOrgActivityType, orgActivityCategory } from "./org-activity-types";

describe("company activity registry", () => {
  it("classifies signals and workspace events", () => {
    expect(orgActivityCategory(assertOrgActivityType("funding"))).toBe("signal");
    expect(orgActivityCategory(assertOrgActivityType("note"))).toBe("workspace");
    expect(() => assertOrgActivityType("made_up")).toThrow();
  });
});
