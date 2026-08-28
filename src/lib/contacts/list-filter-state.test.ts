import { describe, expect, it } from "vitest";
import {
  contactListHasProvenanceFilters,
  describeContactListFilterChips,
  formatContactListCountLabel,
  parseContactListFilterState,
  removeContactListFilterKeys,
} from "@/lib/contacts/list-filter-state";

describe("contact list filter state", () => {
  it("parses URL params into filter state", () => {
    const filters = parseContactListFilterState({
      search: "ramp",
      platform: "linkedin",
      hasRelationshipGoal: "true",
      enrichmentTier: "sparse",
      archived: "true",
    });
    expect(filters.search).toBe("ramp");
    expect(filters.platform).toBe("linkedin");
    expect(filters.hasRelationshipGoal).toBe(true);
    expect(filters.enrichmentTier).toBe("sparse");
    expect(filters.archived).toBe(true);
  });

  it("builds removable filter chips with labels", () => {
    const chips = describeContactListFilterChips({
      search: "ada",
      platform: "x",
      relationshipGoal: "follow_back",
      createdSource: "agent",
      maxEnrichmentScore: "39",
      sort: "enrichmentScore",
      order: "asc",
    });
    expect(chips.map((chip) => chip.id)).toEqual([
      "search",
      "platform",
      "relationshipGoal",
      "maxEnrichmentScore",
      "sort",
      "createdSource",
    ]);
  });

  it("removes linked keys for enrichment tier chips", () => {
    const next = removeContactListFilterKeys(
      { enrichmentTier: "sparse", minEnrichmentScore: "20", maxEnrichmentScore: "39" },
      ["enrichmentTier"],
    );
    expect(next.enrichmentTier).toBeUndefined();
    expect(next.minEnrichmentScore).toBeUndefined();
    expect(next.maxEnrichmentScore).toBeUndefined();
  });

  it("detects provenance-only filters", () => {
    expect(contactListHasProvenanceFilters({ createdSource: "agent" })).toBe(true);
    expect(contactListHasProvenanceFilters({ platform: "x" })).toBe(false);
  });

  it("formats filtered vs total contact counts", () => {
    expect(formatContactListCountLabel(82, 2658, true)).toBe("82 of 2,658 contacts");
    expect(formatContactListCountLabel(2658, 2658, true)).toBe("2,658 contacts");
    expect(formatContactListCountLabel(1, 10, false)).toBe("1 contact");
  });
});
