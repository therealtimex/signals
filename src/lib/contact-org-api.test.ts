import { beforeEach, describe, expect, it } from "vitest";
import { createOrg } from "@/lib/db/queries/orgs";
import {
  resolveContactCompanyFields,
  shouldSyncCompanyGraphOnUpdate,
} from "@/lib/contact-org-api";
import { resetCoreTables } from "@/test/db";

describe("contact-org-api", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("resolves company from orgId", () => {
    const org = createOrg({ name: "Acme Corp", source: "test" });
    const resolved = resolveContactCompanyFields({ orgId: org.id });
    expect(resolved).toEqual({ company: "Acme Corp", orgId: org.id, touched: true });
  });

  it("returns error for unknown orgId", () => {
    const resolved = resolveContactCompanyFields({ orgId: "missing" });
    expect(resolved).toEqual({ error: "Organization not found" });
  });

  it("clears company when org fields are empty", () => {
    const resolved = resolveContactCompanyFields({ orgId: "", company: "" });
    expect(resolved).toEqual({ company: null, touched: true });
  });

  it("detects graph sync on title-only updates", () => {
    expect(shouldSyncCompanyGraphOnUpdate({ title: "CTO" })).toBe(true);
    expect(shouldSyncCompanyGraphOnUpdate({})).toBe(false);
  });
});
