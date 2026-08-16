import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, updateContact, getContactById } from "@/lib/db/queries/contacts";
import {
  applyLegacyCompanyTitle,
  ensureContactEmployment,
  syncEmploymentInputs,
  EmploymentWriteError,
} from "@/lib/db/queries/contact-employment-writes";
import {
  createContactEmployment,
  listContactEmployments,
} from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { db } from "@/lib/db/client";
import { contactEmployments, contacts, graphEdges } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact-employment-writes", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("applies legacy company/title shim into a current employment", () => {
    const contact = createContact({ name: "Ada" });

    applyLegacyCompanyTitle(
      contact.id,
      { company: "Acme Corp", title: "CEO" },
      "api:create_contact",
    );

    const employments = listContactEmployments(contact.id);
    expect(employments).toHaveLength(1);
    expect(employments[0]?.title).toBe("CEO");
    expect(getContactById(contact.id)?.company).toBe("Acme Corp");
  });

  it("clears employments and scalars when legacy company is cleared", () => {
    const contact = createContact({ name: "Ada", company: "Acme Corp", title: "CEO" });
    expect(listContactEmployments(contact.id)).toHaveLength(1);

    updateContact(contact.id, { company: "", orgId: "" });

    expect(listContactEmployments(contact.id)).toHaveLength(0);
    expect(getContactById(contact.id)?.company).toBeNull();
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all()).toHaveLength(0);
  });

  it("updates title on the current employment without changing org", () => {
    const contact = createContact({ name: "Ada", company: "Acme Corp", title: "CEO" });
    const org = createOrg({ name: "Acme Corp", source: "test" });

    updateContact(contact.id, { title: "CTO" });

    const employments = listContactEmployments(contact.id);
    expect(employments).toHaveLength(1);
    expect(employments[0]?.orgId).toBe(org.id);
    expect(employments[0]?.title).toBe("CTO");
  });

  it("deduplicates employments by natural key through ensureContactEmployment", () => {
    const contact = createContact({ name: "Ada" });
    const org = createOrg({ name: "Acme Corp", source: "test" });

    ensureContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Engineer",
      source: "manual",
    });
    ensureContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Engineer",
      source: "manual",
    });

    expect(listContactEmployments(contact.id)).toHaveLength(1);
  });

  it("rejects a foreign employment id during sync", () => {
    const owner = createContact({ name: "Owner" });
    const other = createContact({ name: "Other" });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    const foreign = createContactEmployment({
      contactId: other.id,
      orgId: org.id,
      title: "CEO",
      source: "test",
    });

    expect(() =>
      syncEmploymentInputs(
        owner.id,
        [{ id: foreign.id, orgId: org.id, title: "CEO" }],
        "test",
      ),
    ).toThrow(EmploymentWriteError);
  });

  it("does not delete employments when sync validation fails", () => {
    const contact = createContact({ name: "Ada" });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    const first = createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "CEO",
      source: "test",
    });
    const second = createContactEmployment({
      contactId: contact.id,
      orgId: org.id,
      title: "Advisor",
      startedAt: 100,
      source: "test",
    });

    expect(() =>
      syncEmploymentInputs(
        contact.id,
        [{ id: first.id, orgId: "missing-org", title: "CEO" }],
        "test",
      ),
    ).toThrow(EmploymentWriteError);

    const ids = db
      .select({ id: contactEmployments.id })
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, contact.id))
      .all()
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual([first.id, second.id].sort());
  });

  it("resolves company/title from structured employments on create", () => {
    const org = createOrg({ name: "Beta LLC", source: "test" });
    const contact = createContact({
      name: "Structured",
      employments: [{ orgId: org.id, title: "Founder", isCurrent: true }],
    });

    const dto = getContactById(contact.id);
    expect(dto?.company).toBe("Beta LLC");
    expect(dto?.title).toBe("Founder");
  });
});
