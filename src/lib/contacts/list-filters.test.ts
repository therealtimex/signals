import { describe, expect, it } from "vitest";
import {
  enrichmentTierToScoreRange,
  parseContactListSort,
  contactListSortValue,
} from "@/lib/contacts/list-filters";

describe("contact list filters", () => {
  it("maps enrichment tiers to score ranges", () => {
    expect(enrichmentTierToScoreRange("sparse")).toEqual({
      minEnrichmentScore: 20,
      maxEnrichmentScore: 39,
    });
    expect(enrichmentTierToScoreRange("minimal")).toEqual({ maxEnrichmentScore: 19 });
    expect(enrichmentTierToScoreRange("rich")).toEqual({ minEnrichmentScore: 80 });
  });

  it("parses sort and order with enrichment defaults", () => {
    expect(parseContactListSort()).toEqual({ sort: "createdAt", order: "desc" });
    expect(parseContactListSort("enrichmentScore")).toEqual({
      sort: "enrichmentScore",
      order: "asc",
    });
    expect(parseContactListSort("enrichmentScore", "desc")).toEqual({
      sort: "enrichmentScore",
      order: "desc",
    });
  });

  it("builds stable sort select values", () => {
    expect(contactListSortValue("createdAt", "desc")).toBe("createdAt-desc");
    expect(contactListSortValue("enrichmentScore", "asc")).toBe("enrichmentScore-asc");
  });
});
