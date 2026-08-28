import { describe, expect, it } from "vitest";
import { contactListFiltersEqual } from "@/lib/contacts/list-filter-state";
import {
  BUILTIN_CONTACT_LIST_VIEWS,
  matchBuiltinContactListView,
  savedViewToQueryString,
} from "@/lib/contacts/list-saved-views";

describe("contact list saved views", () => {
  it("includes operational built-in views", () => {
    const ids = BUILTIN_CONTACT_LIST_VIEWS.map((view) => view.id);
    expect(ids).toContain("needs-enrichment");
    expect(ids).toContain("follow-back-queue");
    expect(ids).toContain("linkedin");
  });

  it("serializes a built-in view to query params", () => {
    const view = BUILTIN_CONTACT_LIST_VIEWS.find((entry) => entry.id === "needs-enrichment");
    expect(view).toBeDefined();
    if (!view) return;
    expect(savedViewToQueryString(view)).toContain("maxEnrichmentScore=39");
    expect(savedViewToQueryString(view)).toContain("sort=enrichmentScore");
  });

  it("matches the active built-in view", () => {
    const matched = matchBuiltinContactListView({
      platform: "linkedin",
    });
    expect(matched?.id).toBe("linkedin");
    expect(
      contactListFiltersEqual(matched!.filters, {
        platform: "linkedin",
      }),
    ).toBe(true);
  });
});
