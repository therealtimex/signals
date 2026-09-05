import { describe, expect, it } from "vitest";
import { orgInitials, peopleSummary } from "@/lib/orgs/org-list-display";

describe("orgInitials", () => {
  it("uses the first two words, like the contact avatar does", () => {
    expect(orgInitials("Y Combinator")).toBe("YC");
    expect(orgInitials("The World Bank")).toBe("TW");
  });

  it("falls back to two characters for single-word names", () => {
    expect(orgInitials("CrewAI")).toBe("CR");
    expect(orgInitials("X")).toBe("X");
  });

  it("survives whitespace and empty names rather than rendering blank", () => {
    expect(orgInitials("  Lux   Capital  ")).toBe("LC");
    expect(orgInitials("   ")).toBe("?");
  });
});

describe("peopleSummary", () => {
  it("reads as a sentence at each cardinality", () => {
    expect(peopleSummary(0, [])).toBe("No linked people");
    expect(peopleSummary(1, ["Ada Lovelace"])).toBe("1 person · Ada Lovelace");
    expect(peopleSummary(2, ["Ada Lovelace", "Alan Turing"])).toBe(
      "2 people · Ada Lovelace, Alan Turing",
    );
  });

  it("counts the overflow against the total, not the names it was given", () => {
    expect(peopleSummary(16, ["Michael Seibel", "Aaron Max Epstein"])).toBe(
      "16 people · Michael Seibel, Aaron Max Epstein +14",
    );
  });

  it("shows the count alone when every linked name was the org itself", () => {
    // A company page stored as a contact links to its own org; naming it twice tells nobody
    // anything, so the name list can legitimately arrive empty with a non-zero count.
    expect(peopleSummary(1, [])).toBe("1 person");
  });
});
