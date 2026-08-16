import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import {
  backfillEmployments,
  countContactsWithScalarCompany,
  countEmployments,
  countScalarCompaniesMissingEmployment,
} from "@/lib/db/backfills/employments";
import { db } from "@/lib/db/client";
import { contactEmployments, graphEdges } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("backfillEmployments", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("re-projects works_at from existing employments idempotently", () => {
    const contact = createContact({ name: "Worker", platform: "x", platformUserId: "worker-1" });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "CEO",
      isCurrent: true,
      source: "test",
    });

    const first = backfillEmployments();
    expect(first.inserted).toBe(0);
    expect(countEmployments()).toBe(1);
    expect(countScalarCompaniesMissingEmployment()).toBe(0);
    expect(countContactsWithScalarCompany()).toBe(0);

    const second = backfillEmployments();
    expect(second.inserted).toBe(0);

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe(org.id);
  });

  it("creates employment from legacy company/title shim writes", () => {
    const contact = createContact({
      name: "Free Text Worker",
      company: "Beta LLC",
      title: "Engineer",
    });

    const employment = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, contact.id))
      .get();
    expect(employment).toBeDefined();

    const org = db.select().from(contactEmployments).all();
    expect(org).toHaveLength(1);
    expect(contact.company).toBe("Beta LLC");
    expect(contact.title).toBe("Engineer");
  });
});
