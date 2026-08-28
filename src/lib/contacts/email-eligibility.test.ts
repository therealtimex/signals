import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resolveAutomationEmail, resolveCandidateEmailEligibility } from "./email-eligibility";
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

  it.each([
    ["predicted", false, false, false, "predicted_email_disabled"],
    ["predicted", true, false, false, "predicted_email_not_requested"],
    ["predicted", true, true, true, undefined],
    ["uncertain", true, true, false, "email_not_verified"],
    ["invalid", true, true, false, "invalid_email"],
    ["verified", false, false, true, undefined],
  ] as const)("derives one eligibility result for %s", (status, allowPredicted, includePredicted, sendable, reason) => {
    expect(resolveCandidateEmailEligibility(status, { allowPredicted, includePredicted })).toEqual({
      sendable,
      ...(reason ? { reason } : {}),
    });
  });

  it("requires both the global and per-operation predicted opt-ins", () => {
    const org = createOrg({ name: "Opt-in Co" });
    const contact = createContact({ name: "Opt In" });
    db.insert(contactEmailCandidates).values({
      id: nanoid(), contactId: contact.id, orgId: org.id,
      address: "optin@example.com", addressNormalized: "optin@example.com",
      status: "predicted", confidence: "high", source: "test",
    }).run();
    vi.stubEnv("SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION", "1");
    expect(resolveAutomationEmail(contact.id)).toMatchObject({ eligible: false, reason: "predicted_email_not_requested" });
    expect(resolveAutomationEmail(contact.id, { includePredicted: true })).toMatchObject({ eligible: true });
  });
});
