import { describe, expect, it } from "vitest";
import { isValidEmailPattern, matchPattern, renderPattern } from "./patterns";

describe("company email patterns", () => {
  it("validates the supported grammar", () => {
    expect(isValidEmailPattern("{first}.{last}")).toBe(true);
    expect(isValidEmailPattern("{f}{last}")).toBe(true);
    expect(isValidEmailPattern("first.last")).toBe(false);
    expect(isValidEmailPattern("{first}+")).toBe(false);
  });

  it("renders and matches deterministic templates", () => {
    const parts = { first: "ada", last: "lovelace" };
    expect(renderPattern("{f}{last}", parts)).toBe("alovelace");
    expect(matchPattern("ada.lovelace", parts)).toContain("{first}.{last}");
  });
});
