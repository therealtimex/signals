import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity, updateIdentity } from "@/lib/db/queries/identities";
import { ensureOrgByName } from "@/lib/db/queries/orgs";
import {
  createOrgIdentity,
  listOrgIdentityMetrics,
  updateOrgIdentity,
  upsertOrgIdentity,
} from "@/lib/db/queries/org-identities";
import { upsertGraphEdge, validateEdgeEndpoints } from "@/lib/db/queries/graph";
import {
  PlatformAccountConflictError,
  type PlatformAccountClaimedBy,
} from "@/lib/db/identity-claims";
import { auditGraphIntegrity } from "@/lib/db/graph-integrity";
import { db } from "@/lib/db/client";
import { contactIdentities, orgIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function expectPlatformConflict(
  run: () => unknown,
  expected: { platform: string; platformUserId: string; claimedBy: PlatformAccountClaimedBy },
) {
  try {
    run();
    throw new Error("Expected PlatformAccountConflictError");
  } catch (error) {
    expect(error).toBeInstanceOf(PlatformAccountConflictError);
    const conflict = error as PlatformAccountConflictError;
    expect(conflict.platform).toBe(expected.platform);
    expect(conflict.platformUserId).toBe(expected.platformUserId);
    expect(conflict.claimedBy).toEqual(expected.claimedBy);
  }
}

describe("org identities", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates, updates, and lists org identities with stat lift", () => {
    const org = ensureOrgByName("Northwind");
    const created = createOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "org-li-1",
      platformData: JSON.stringify({ followers_count: 1200, display_name: "Northwind Co" }),
    });

    expect(created.displayName).toBe("Northwind Co");
    expect(created.followersCount).toBe(1200);

    const updated = updateOrgIdentity(created.id, { followersCount: 1300 });
    expect(updated?.followersCount).toBe(1300);

    const metrics = listOrgIdentityMetrics(created.id);
    expect(metrics).toHaveLength(2);
    expect(metrics[0]?.followersCount).toBe(1300);
  });

  it("does not append metrics when stat counts are unchanged", () => {
    const org = ensureOrgByName("Contoso");
    const created = createOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "org-x-1",
      followersCount: 50,
    });

    updateOrgIdentity(created.id, { displayName: "Contoso Labs" });
    expect(listOrgIdentityMetrics(created.id)).toHaveLength(1);
  });

  it("rejects cross-table platform account claims on contact and org writes", () => {
    const org = ensureOrgByName("Acme");
    const contact = createContact({ name: "Pat", platform: "x", platformUserId: "pat-1" });
    const contactIdentity = createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "shared-li",
    });

    expectPlatformConflict(
      () =>
        createOrgIdentity({
          orgId: org.id,
          platform: "linkedin",
          platformUserId: "shared-li",
        }),
      {
        platform: "linkedin",
        platformUserId: "shared-li",
        claimedBy: { kind: "contact", id: contactIdentity.id },
      },
    );

    const orgIdentity = createOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "org-only",
    });

    expectPlatformConflict(
      () =>
        createIdentity({
          contactId: contact.id,
          platform: "x",
          platformUserId: "org-only",
        }),
      {
        platform: "x",
        platformUserId: "org-only",
        claimedBy: { kind: "org", id: orgIdentity.id },
      },
    );
  });

  it("rejects updateIdentity when retargeting to an org-owned natural key", () => {
    const org = ensureOrgByName("Retarget Org");
    const contact = createContact({ name: "Riley", platform: "x", platformUserId: "riley-1" });
    const orgIdentity = createOrgIdentity({
      orgId: org.id,
      platform: "instagram",
      platformUserId: "ig-shared",
    });
    const contactIdentity = createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "li-original",
    });

    expectPlatformConflict(
      () =>
        updateIdentity(contactIdentity.id, {
          platform: "instagram",
          platformUserId: "ig-shared",
        }),
      {
        platform: "instagram",
        platformUserId: "ig-shared",
        claimedBy: { kind: "org", id: orgIdentity.id },
      },
    );
  });

  it("rejects updateOrgIdentity when retargeting to a contact-owned natural key", () => {
    const org = ensureOrgByName("Retarget Org 2");
    const contact = createContact({ name: "Jordan", platform: "x", platformUserId: "jordan-1" });
    const contactIdentity = createIdentity({
      contactId: contact.id,
      platform: "threads",
      platformUserId: "threads-shared",
    });
    const orgIdentity = createOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "li-original",
    });

    expectPlatformConflict(
      () =>
        updateOrgIdentity(orgIdentity.id, {
          platform: "threads",
          platformUserId: "threads-shared",
        }),
      {
        platform: "threads",
        platformUserId: "threads-shared",
        claimedBy: { kind: "contact", id: contactIdentity.id },
      },
    );
  });

  it("allows contact identity updates without self-conflict", () => {
    const contact = createContact({ name: "Sam", platform: "x", platformUserId: "sam-1" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "sam-li",
    });

    const updated = updateIdentity(identity.id, { displayName: "Sam I." });
    expect(updated?.displayName).toBe("Sam I.");
  });

  it("allows org identity updates without self-conflict", () => {
    const org = ensureOrgByName("Self Org");
    const identity = createOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "self-org-li",
      displayName: "Before",
    });

    const updated = updateOrgIdentity(identity.id, {
      platform: "linkedin",
      platformUserId: "self-org-li",
      displayName: "After",
    });
    expect(updated?.displayName).toBe("After");
  });

  it("reports duplicate_platform_account in graph integrity", () => {
    const org = ensureOrgByName("Globex");
    const contact = createContact({ name: "Alex", platform: "x", platformUserId: "alex-1" });

    db.insert(contactIdentities)
      .values({
        id: "contact-identity-dup",
        contactId: contact.id,
        platform: "instagram",
        platformUserId: "dup-ig",
      })
      .run();
    db.insert(orgIdentities)
      .values({
        id: "org-identity-dup",
        orgId: org.id,
        platform: "instagram",
        platformUserId: "dup-ig",
      })
      .run();

    const report = auditGraphIntegrity();
    expect(report.duplicatePlatformAccounts).toHaveLength(1);
    expect(report.duplicatePlatformAccounts[0]?.reason).toBe("duplicate_platform_account");
    expect(report.issueCount).toBeGreaterThanOrEqual(1);
  });

  it("validates org_identity graph endpoints", () => {
    const org = ensureOrgByName("Initech");
    const identity = createOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "initech-li",
    });

    expect(() =>
      validateEdgeEndpoints("org", org.id, "org_identity", identity.id),
    ).not.toThrow();

    upsertGraphEdge({
      srcType: "org",
      srcId: org.id,
      dstType: "org_identity",
      dstId: identity.id,
      edgeType: "owns_identity",
    });

    db.delete(orgIdentities).where(eq(orgIdentities.id, identity.id)).run();
    const report = auditGraphIntegrity();
    expect(report.issues.some((issue) => issue.nodeType === "org_identity")).toBe(true);
  });

  it("upserts by explicit id", () => {
    const org = ensureOrgByName("Hooli");
    const created = upsertOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "hooli-x",
    });

    const updated = upsertOrgIdentity({
      id: created.id,
      orgId: org.id,
      platform: "x",
      platformUserId: "hooli-x",
      bio: "Enterprise software",
    });
    expect(updated.bio).toBe("Enterprise software");
  });
});
