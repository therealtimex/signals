import { describe, expect, it } from "vitest";
import { readRunLimitFromTemplateConfig } from "@/app/dashboard/workflows/activate-dialog.utils";
import {
  isOrgDedupeTemplateConfig,
  readOrgDedupeControls,
  tierPresetFor,
} from "@/lib/orgs/dedupe/template";

const COMPANIES_CONFIG = {
  orgDedupe: { version: 1, tiers: [1, 2], minConfidence: 0.6, limit: 25 },
};
const CONTACTS_CONFIG = { tiers: [1, 2], minConfidence: 0.8, limit: 25 };
const PRUNE_CONFIG = { companyName: "", inactivityDays: 365, maxContacts: 20 };

describe("org dedupe activation fields", () => {
  it("claims the companies template and nothing else", () => {
    // The activation form picks fields by templateType alone, so every pruning template got
    // "Company Name" and "Inactivity Days" — meaningless for a deduper (#452 follow-up).
    expect(isOrgDedupeTemplateConfig(COMPANIES_CONFIG)).toBe(true);
    expect(isOrgDedupeTemplateConfig(CONTACTS_CONFIG)).toBe(false);
    expect(isOrgDedupeTemplateConfig(PRUNE_CONFIG)).toBe(false);
  });

  it("seeds the form from the template's own controls", () => {
    const limits = readRunLimitFromTemplateConfig(COMPANIES_CONFIG);
    expect(limits.orgDedupeTiers).toBe("1-2");
    expect(limits.orgDedupeLimit).toBe("25");
  });

  it("round-trips a tier-1-only, tuned-limit template", () => {
    const tuned = { orgDedupe: { tiers: [1], minConfidence: 0.6, limit: 10 } };
    const limits = readRunLimitFromTemplateConfig(tuned);
    expect(limits.orgDedupeTiers).toBe("1");
    expect(limits.orgDedupeLimit).toBe("10");
  });

  it("falls back to defaults when the template carries no controls", () => {
    const controls = readOrgDedupeControls({});
    expect(controls).toEqual({ tiers: [1, 2], minConfidence: 0.6, limit: 25 });
    expect(tierPresetFor(controls.tiers)).toBe("1-2");
  });

  it("ignores tiers the org detector does not have", () => {
    // Contact dedupe has a tier 3; orgs do not (ADR-445-5 removed the domain/identity tier).
    expect(readOrgDedupeControls({ orgDedupe: { tiers: [1, 2, 3] } }).tiers).toEqual([1, 2]);
    expect(readOrgDedupeControls({ orgDedupe: { tiers: [] } }).tiers).toEqual([1, 2]);
  });
});
