import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resolveAutomationEmail } from "./email-eligibility";
import { resetCoreTables } from "@/test/db";

describe("automation email eligibility", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.stubEnv("SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION", "0");
  });

  it("defaults predicted addresses to not sendable", () => {
    const org = createOrg({ name: "Safe Co" });
    const contact = createContact({ name: "Safe Person" });
    db.insert(contactEmailCandidates).values({
      id: nanoid(), contactId: contact.id, orgId: org.id,
      address: "safe@example.com", addressNormalized: "safe@example.com",
      status: "predicted", confidence: "high", source: "test",
    }).run();
    expect(resolveAutomationEmail(contact.id, { includePredicted: true })).toMatchObject({
      address: "safe@example.com",
      eligible: false,
      status: "predicted",
    });
  });
});
