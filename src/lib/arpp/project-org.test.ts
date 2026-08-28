import { describe, expect, it } from "vitest";
import { projectOrgToAroo } from "@/lib/arpp/project-org";
import type { Org } from "@/lib/db/types";

function baseOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: "org_37",
    name: "37signals",
    orgType: "company",
    domain: "37signals.com",
    website: "https://37signals.com",
    description: "We build project management and email tools.",
    location: "Chicago, IL",
    avatarUrl: "https://37signals.com/logo.png",
    industry: "Computer Software",
    companySize: "51-200",
    tags: "[]",
    ownerContactId: null,
    accountStage: "customer",
    followedAt: null,
    feedSeenAt: null,
    enrichmentScore: 42,
    scope: "shared",
    metadata: JSON.stringify({ identifiers: { ror: "012mzw209" } }),
    source: null,
    createdSource: "manual",
    createdSourceDetail: null,
    createdWorkflowRunId: null,
    createdTemplateId: null,
    createdAt: 1,
    updatedAt: 1_727_500_000,
    ...overrides,
  };
}

describe("projectOrgToAroo", () => {
  it("projects org identity and ROR identifier", () => {
    const doc = projectOrgToAroo({ org: baseOrg() });

    expect(doc.spec).toBe("aroo/1.0");
    expect(doc.identity.name).toBe("37signals");
    expect(doc.identity.numberOfEmployees).toEqual({
      min: 51,
      max: 200,
      unitText: "employees",
    });
    expect(doc.identifiers.some((id) => id.scheme === "ror")).toBe(true);
    expect(doc.domains).toEqual([
      { domain: "37signals.com", kind: "primary", verified: false },
    ]);
    expect(doc.signals.orgId).toBe("org_37");
    expect(doc.signals.conformance).toBe("O2");
  });

  it("omits CRM fields in public visibility", () => {
    const doc = projectOrgToAroo({ org: baseOrg() }, { visibility: "public" });

    expect(doc.signals.accountStage).toBeUndefined();
    expect(doc.signals.ownerContactId).toBeUndefined();
    expect(doc.meta.visibility).toBe("public");
  });

  it("classifies sparse org as O0", () => {
    const doc = projectOrgToAroo({
      org: baseOrg({
        description: null,
        industry: null,
        companySize: null,
        domain: null,
        metadata: "{}",
      }),
      domains: [],
      identities: [],
    });

    expect(doc.signals.conformance).toBe("O0");
  });
});
