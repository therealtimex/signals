import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import {
  createContactEmployment,
  deleteContactEmployment,
  listContactEmployments,
  resolveCurrentEmployment,
  updateContactEmployment,
} from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { db } from "@/lib/db/client";
import { contactEmployments, contacts, graphEdges } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact-employments", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates an employment linked to an org", () => {
    const contact = createContact({ name: "Ada" });
    const org = createOrg({ name: "Acme Corp", source: "test" });

    const employment = createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Engineer",
      source: "manual",
    });

    expect(employment.orgId).toBe(org.id);
    expect(employment.title).toBe("Engineer");
    expect(listContactEmployments(contact.id)).toHaveLength(1);
  });

  it("projects company/title scalars and works_at edges after mutation", () => {
    const contact = createContact({ name: "Ada" });
    const org = createOrg({ name: "Acme Corp", source: "test" });

    createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "CEO",
      source: "manual",
    });

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.company).toBe("Acme Corp");
    expect(row?.title).toBe("CEO");

    const dto = getContactById(contact.id);
    expect(dto?.company).toBe("Acme Corp");
    expect(dto?.currentEmployment).toMatchObject({
      orgId: org.id,
      orgName: "Acme Corp",
      title: "CEO",
    });

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CEO",
      is_current: true,
    });
  });

  it("resolves current employment by latest started_at then created_at", () => {
    const contact = createContact({ name: "Ada" });
    const olderOrg = createOrg({ name: "Old Co", source: "test" });
    const newerOrg = createOrg({ name: "New Co", source: "test" });

    createContactEmployment({
      contactId: contact.id,
      orgId: olderOrg.id,
      title: "Past",
      startedAt: 100,
      isCurrent: true,
      source: "manual",
    });
    createContactEmployment({
      contactId: contact.id,
      orgId: newerOrg.id,
      title: "Present",
      startedAt: 200,
      isCurrent: true,
      source: "manual",
    });

    expect(resolveCurrentEmployment(contact.id)).toMatchObject({
      orgId: newerOrg.id,
      title: "Present",
    });
  });

  it("removes works_at edge when the last employment for an org is deleted", () => {
    const contact = createContact({ name: "Leaver" });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    const employment = createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "CEO",
      source: "manual",
    });

    deleteContactEmployment(employment.id);

    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all()).toHaveLength(0);
    expect(db.select().from(contactEmployments).all()).toHaveLength(0);
  });

  it("updates employment title in place", () => {
    const contact = createContact({ name: "Promoted" });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    const employment = createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Engineer",
      source: "manual",
    });

    updateContactEmployment(employment.id, { title: "Staff Engineer" });

    expect(getContactById(contact.id)?.title).toBe("Staff Engineer");
  });
});
