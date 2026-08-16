import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createOrg } from "@/lib/db/queries/orgs";
import {
  backfillEmployments,
  countContactsWithScalarCompany,
  countEmployments,
  countScalarCompaniesMissingEmployment,
} from "@/lib/db/backfills/employments";
import { db } from "@/lib/db/client";
import { contactEmployments, contacts, graphEdges, orgs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("backfillEmployments", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("backfills company/title scalars into employments and re-projects works_at", () => {
    const orgId = nanoid();
    db.insert(orgs)
      .values({
        id: orgId,
        name: "Acme Corp",
        orgType: "company",
        scope: "shared",
        source: "test",
      })
      .run();

    const contactId = nanoid();
    db.insert(contacts)
      .values({
        id: contactId,
        name: "Legacy Worker",
        company: "Acme Corp",
        title: "CEO",
      })
      .run();

    db.insert(graphEdges)
      .values({
        id: nanoid(),
        srcType: "contact",
        srcId: contactId,
        dstType: "org",
        dstId: orgId,
        edgeType: "works_at",
        properties: JSON.stringify({ title: "CEO", is_current: true }),
        scope: "shared",
        source: "test",
      })
      .run();

    const first = backfillEmployments();
    expect(first.inserted).toBe(1);
    expect(countEmployments()).toBe(1);
    expect(countScalarCompaniesMissingEmployment()).toBe(0);

    const second = backfillEmployments();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);

    const employment = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, contactId))
      .get();
    expect(employment?.orgId).toBe(orgId);
    expect(employment?.title).toBe("CEO");

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe(orgId);
  });

  it("creates org by name when no works_at edge exists", () => {
    const contactId = nanoid();
    db.insert(contacts)
      .values({
        id: contactId,
        name: "Free Text Worker",
        company: "Beta LLC",
        title: "Engineer",
      })
      .run();

    const result = backfillEmployments();
    expect(result.inserted).toBe(1);
    expect(countContactsWithScalarCompany()).toBe(1);

    const org = db.select().from(orgs).where(eq(orgs.name, "Beta LLC")).get();
    expect(org).toBeDefined();

    const employment = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, contactId))
      .get();
    expect(employment?.orgId).toBe(org?.id);
  });
});
