import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { dualWriteContactCompany } from "@/lib/db/contact-org-dual-write";
import { createOrg } from "@/lib/db/queries/orgs";
import { findDuplicateOrgs } from "@/lib/orgs/dedupe/detect";
import { resetCoreTables } from "@/test/db";

function pairFor(names: [string, string]) {
  const [a, b] = names;
  return findDuplicateOrgs().find((candidate) => {
    const found = candidate.members.map((m) => m.name).sort();
    return found[0] === [a, b].sort()[0] && found[1] === [a, b].sort()[1];
  });
}

describe("findDuplicateOrgs", () => {
  beforeEach(() => resetCoreTables());

  it("does not look for shared domains or identities, which the write path already forbids", () => {
    // createOrg rejects a duplicate domain and upsertOrgIdentity rejects a claimed platform
    // account, so such a pair cannot exist to be found.
    createOrg({ name: "Acme Labs", domain: "acme.com", source: "test" });
    expect(() =>
      createOrg({ name: "Totally Different", domain: "acme.com", source: "test" }),
    ).toThrow(/already assigned/i);
  });

  it("collapses corporate suffixes and punctuation into one name key", () => {
    createOrg({ name: "Mekong Organics", source: "test" });
    createOrg({ name: "Mekong Organics PTY LTD", source: "test" });

    const candidate = pairFor(["Mekong Organics", "Mekong Organics PTY LTD"])!;
    expect(candidate.tier).toBe(1);
    expect(candidate.reason).toBe("Identical normalized name");
  });

  it("flags a name that contains another as a reviewable second tier", () => {
    createOrg({ name: "Andreessen Horowitz", source: "test" });
    createOrg({ name: "Andreessen Horowitz (a16z)", source: "test" });

    const candidate = pairFor(["Andreessen Horowitz", "Andreessen Horowitz (a16z)"])!;
    expect(candidate.tier).toBe(2);
    expect(candidate.confidence).toBeLessThan(1);
  });

  it("does not treat a venture arm, division or region as the parent", () => {
    // Merging these would be wrong and tedious to undo, so containment alone must not suggest it.
    createOrg({ name: "Lockheed Martin", source: "test" });
    createOrg({ name: "Lockheed Martin Ventures", source: "test" });
    createOrg({ name: "FPT Software", source: "test" });
    createOrg({ name: "FPT Software Institute", source: "test" });

    expect(pairFor(["Lockheed Martin", "Lockheed Martin Ventures"])).toBeUndefined();
    expect(pairFor(["FPT Software", "FPT Software Institute"])).toBeUndefined();
  });

  it("does not chain two firms through a shared industry description", () => {
    createOrg({ name: "Venture Capital", source: "test" });
    createOrg({ name: "Wing Venture Capital", source: "test" });

    expect(pairFor(["Venture Capital", "Wing Venture Capital"])).toBeUndefined();
  });

  it("does not read a dual-affiliation name as a longer rendering", () => {
    createOrg({ name: "UC Berkeley", source: "test" });
    createOrg({ name: "UC Berkeley / Physical Intelligence", source: "test" });

    expect(pairFor(["UC Berkeley", "UC Berkeley / Physical Intelligence"])).toBeUndefined();
  });

  it("suggests the record holding more people as the survivor", () => {
    createOrg({ name: "Bigco", source: "test" });
    createOrg({ name: "Bigco Inc", source: "test" });
    for (const name of ["P1", "P2"]) {
      dualWriteContactCompany(createContact({ name }).id, "Bigco Inc", "Role");
    }
    dualWriteContactCompany(createContact({ name: "P3" }).id, "Bigco", "Role");

    const candidate = pairFor(["Bigco", "Bigco Inc"])!;
    const primary = candidate.members.find((m) => m.orgId === candidate.primaryOrgId)!;
    expect(primary.name).toBe("Bigco Inc");
    expect(primary.contactCount).toBe(2);
  });

  it("honours tier and limit filters", () => {
    createOrg({ name: "Zeta Organics", source: "test" });
    createOrg({ name: "Zeta Organics LLC", source: "test" });

    createOrg({ name: "Contained Base Name", source: "test" });
    createOrg({ name: "Contained Base Name Extra", source: "test" });

    expect(findDuplicateOrgs({ tiers: [1] }).every((c) => c.tier === 1)).toBe(true);
    expect(findDuplicateOrgs({ limit: 1 })).toHaveLength(1);
    expect(findDuplicateOrgs({ minConfidence: 0.95 }).every((c) => c.confidence >= 0.95)).toBe(true);
  });
});
