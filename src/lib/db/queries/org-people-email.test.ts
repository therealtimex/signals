import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";
import { listOrgPeople } from "./org-people";

describe("company people active email", () => {
  beforeEach(resetCoreTables);

  it("shows the newest non-superseded candidate", () => {
    const org = createOrg({ name: "People Email Co" });
    const contact = createContact({ name: "Person" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    db.insert(contactEmailCandidates).values([
      {
        id: "old", contactId: contact.id, orgId: org.id,
        address: "old@example.com", addressNormalized: "old@example.com",
        status: "invalid", confidence: "low", source: "test",
        evidence: JSON.stringify({ supersededBy: "new" }), createdAt: 300, updatedAt: 300,
      },
      {
        id: "new", contactId: contact.id, orgId: org.id,
        address: "new@example.com", addressNormalized: "new@example.com",
        status: "predicted", confidence: "high", source: "manual:correct_email",
        evidence: JSON.stringify({ correctedFrom: "old", correctedAt: 200 }), createdAt: 200, updatedAt: 200,
      },
    ]).run();

    expect(listOrgPeople(org.id).data[0].emailStatus).toEqual({
      status: "predicted", address: "new@example.com",
    });
  });
});
