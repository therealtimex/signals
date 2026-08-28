import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resolveAutomationEmail, resolveCandidateEmailEligibility } from "./email-eligibility";
import { resetCoreTables } from "@/test/db";
import { updateEmailCandidate } from "@/lib/contacts/email-verification/candidates";

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

  it("selects a manual correction and keeps both opt-ins mandatory", async () => {
    const org = createOrg({ name: "Correction Co" });
    const contact = createContact({ name: "Correct Me" });
    const candidateId = nanoid();
    db.insert(contactEmailCandidates).values({
      id: candidateId, contactId: contact.id, orgId: org.id,
      address: "wrong@example.com", addressNormalized: "wrong@example.com",
      status: "predicted", confidence: "high", source: "test",
    }).run();
    const corrected = await updateEmailCandidate(candidateId, {
      action: "correct", address: "correct@example.com",
    });
    vi.stubEnv("SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION", "1");

    expect(corrected).toMatchObject({ address: "correct@example.com", status: "predicted" });
    expect(resolveAutomationEmail(contact.id)).toMatchObject({
      address: "correct@example.com", eligible: false, reason: "predicted_email_not_requested",
    });
    expect(resolveAutomationEmail(contact.id, { includePredicted: true })).toMatchObject({
      address: "correct@example.com", eligible: true,
    });
  });

  it("uses the newest lifecycle across pattern history without falling back after invalidation", () => {
    const org = createOrg({ name: "History Co" });
    const contact = createContact({ name: "Pattern History" });
    db.insert(contactEmailCandidates).values([
      {
        id: "candidate-old", contactId: contact.id, orgId: org.id,
        address: "old@example.com", addressNormalized: "old@example.com",
        status: "predicted", confidence: "low", source: "test", createdAt: 100, updatedAt: 100,
      },
      {
        id: "candidate-new", contactId: contact.id, orgId: org.id,
        address: "new@example.com", addressNormalized: "new@example.com",
        status: "predicted", confidence: "high", source: "test", createdAt: 200, updatedAt: 200,
      },
    ]).run();
    vi.stubEnv("SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION", "1");

    expect(resolveAutomationEmail(contact.id, { includePredicted: true })).toMatchObject({
      address: "new@example.com", eligible: true,
    });
    db.update(contactEmailCandidates).set({ status: "invalid", updatedAt: 300 })
      .where(eq(contactEmailCandidates.id, "candidate-new")).run();
    expect(resolveAutomationEmail(contact.id, { includePredicted: true })).toMatchObject({
      address: "new@example.com", status: "invalid", eligible: false, reason: "invalid_email",
    });
  });
});
