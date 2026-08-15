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
import { PlatformAccountConflictError } from "@/lib/db/identity-claims";
import { auditGraphIntegrity } from "@/lib/db/graph-integrity";
import { handleUpsertOrgIdentity } from "@/lib/agent-tools/graph-handlers";
import { db } from "@/lib/db/client";
import { contactIdentities, orgIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

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
    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "shared-li",
    });

    expect(() =>
      createOrgIdentity({
        orgId: org.id,
        platform: "linkedin",
        platformUserId: "shared-li",
      }),
    ).toThrow(PlatformAccountConflictError);

    createOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "org-only",
    });

    expect(() =>
      createIdentity({
        contactId: contact.id,
        platform: "x",
        platformUserId: "org-only",
      }),
    ).toThrow(/Reassign, don't duplicate/);
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

  it("upserts by natural key within the same org and surfaces conflicts via agent handler", async () => {
    const org = ensureOrgByName("Umbrella");
    const created = await handleUpsertOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "umbrella-li",
      displayName: "Umbrella Corp",
      followersCount: 900,
    });
    expect(created.id).toBeTruthy();

    const updated = await handleUpsertOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "umbrella-li",
      followersCount: 950,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.followersCount).toBe(950);

    const otherOrg = ensureOrgByName("Umbrella EU");
    await expect(
      handleUpsertOrgIdentity({
        orgId: otherOrg.id,
        platform: "linkedin",
        platformUserId: "umbrella-li",
      }),
    ).rejects.toThrow(/Reassign, don't duplicate/);
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
