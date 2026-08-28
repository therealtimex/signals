import { beforeEach, describe, expect, it } from "vitest";
import { createOrg, getOrgDTO, updateOrg } from "@/lib/db/queries/orgs";
import { OrgDomainConflictError, OrgValidationError } from "@/lib/orgs/errors";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { orgDomains } from "@/lib/db/schema";

describe("company profile queries", () => {
  beforeEach(() => resetCoreTables());

  it("normalizes and persists editable profile fields with provenance", () => {
    const org = createOrg({ name: "Acme", provenance: "manual:create_org" });
    const updated = updateOrg(
      org.id,
      {
        domain: "https://www.Acme.com/about",
        website: "acme.com",
        description: "Infrastructure for agents",
      },
      { source: "manual", tag: "manual:update_org" },
    );

    expect(updated).toMatchObject({
      domain: "acme.com",
      website: "https://acme.com/",
      description: "Infrastructure for agents",
    });
    expect(JSON.parse(updated!.metadata ?? "{}").fieldProvenance.domain).toMatchObject({
      source: "manual",
      tag: "manual:update_org",
    });
    expect(getOrgDTO(org.id)).toMatchObject({
      domain: "acme.com",
      provenance: { label: "Manually added" },
    });
  });

  it("records evidence against only the field it supports", () => {
    const org = createOrg({ name: "Evidence Co" });
    const updated = updateOrg(
      org.id,
      { domain: "evidence.example", location: "Remote" },
      {
        source: "agent",
        tag: "agent:enrich_org",
        workflowRunId: "run-1",
        fieldSources: { domain: { evidenceUrl: "https://evidence.example/about" } },
      },
    );

    const fieldProvenance = JSON.parse(updated!.metadata ?? "{}").fieldProvenance;
    expect(fieldProvenance.domain).toMatchObject({
      workflowRunId: "run-1",
      evidenceUrl: "https://evidence.example/about",
    });
    expect(fieldProvenance.location).not.toHaveProperty("evidenceUrl");
  });

  it("rejects invalid and already-claimed domains", () => {
    const first = createOrg({ name: "First", domain: "first.example" });
    const second = createOrg({ name: "Second" });

    expect(() =>
      updateOrg(second.id, { domain: "first.example" }, { source: "api", tag: "api:update_org" }),
    ).toThrow(OrgDomainConflictError);
    expect(() =>
      updateOrg(first.id, { domain: "localhost" }, { source: "api", tag: "api:update_org" }),
    ).toThrow(OrgValidationError);
  });

  it("keeps old domains as aliases when the primary domain changes", () => {
    const org = createOrg({ name: "Alias Co", domain: "old.example" });
    updateOrg(
      org.id,
      { domain: "new.example", industry: "Infrastructure", tags: ["portfolio", "priority"] },
      { source: "manual", tag: "manual:update_org" },
    );

    expect(db.select().from(orgDomains).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orgId: org.id, domain: "old.example", kind: "alias" }),
        expect.objectContaining({ orgId: org.id, domain: "new.example", kind: "primary" }),
      ]),
    );
    expect(getOrgDTO(org.id)).toMatchObject({
      domain: "new.example",
      industry: "Infrastructure",
      tags: ["portfolio", "priority"],
      domains: expect.arrayContaining([
        { domain: "old.example", kind: "alias" },
        { domain: "new.example", kind: "primary" },
      ]),
    });
  });

  it("fills missing fields when create resolves an existing company", () => {
    const original = createOrg({ name: "Acme" });
    const resolved = createOrg({ name: "  ACME ", domain: "acme.com", description: "Filled" });
    expect(resolved.id).toBe(original.id);
    expect(resolved).toMatchObject({ domain: "acme.com", description: "Filled" });
  });
});
