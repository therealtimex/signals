import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactEmailCandidates, orgDomains, orgEmailPatterns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { addOrgDomainAlias, createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";
import { resolveEmailVerificationSettings } from "@/lib/settings/email-verification-settings";
import { updateEmailCandidate } from "./candidates";

function setup() {
  const org = createOrg({ name: "Probe Co", domain: "probe.example" });
  const contact = createContact({ name: "Pat Probe" });
  const id = nanoid();
  db.insert(contactEmailCandidates).values({
    id, contactId: contact.id, orgId: org.id,
    address: "pat@probe.example", addressNormalized: "pat@probe.example",
    status: "predicted", confidence: "high", source: "test",
  }).run();
  return { id, org };
}

const enabled = () => ({
  ...resolveEmailVerificationSettings(),
  smtpProbeEnabled: { ...resolveEmailVerificationSettings().smtpProbeEnabled, effectiveValue: true },
});
const mx = vi.fn().mockResolvedValue([{ exchange: "mx.probe.example", priority: 10 }]);

describe("email candidate SMTP probing", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("records disabled probing as inconclusive without calling a provider", async () => {
    const { id } = setup();
    const probe = vi.fn();
    const result = await updateEmailCandidate(id, { action: "probe" }, { probe });
    expect(result).toMatchObject({ status: "uncertain", probeAttempts: 1 });
    expect(probe).not.toHaveBeenCalled();
  });

  it("verifies an accepted recipient on a non-catch-all domain", async () => {
    const { id, org } = setup();
    const probe = vi.fn()
      .mockResolvedValueOnce({ outcome: "accepted", code: 250 })
      .mockResolvedValueOnce({ outcome: "rejected", code: 550 });
    const result = await updateEmailCandidate(id, { action: "probe" }, {
      settings: enabled, mxResolver: mx, probe, catchAllAddress: () => "random@probe.example",
    });
    expect(result).toMatchObject({ status: "verified", verificationMethod: "smtp_rcpt" });
    expect(db.select().from(orgDomains).where(eq(orgDomains.orgId, org.id)).get()).toMatchObject({ catchAll: "no" });
  });

  it("keeps an accepted recipient uncertain on a catch-all domain", async () => {
    const { id, org } = setup();
    const probe = vi.fn().mockResolvedValue({ outcome: "accepted", code: 250 });
    const result = await updateEmailCandidate(id, { action: "probe" }, {
      settings: enabled, mxResolver: mx, probe,
    });
    expect(result).toMatchObject({ status: "uncertain", verificationMethod: "smtp_rcpt" });
    expect(db.select().from(orgDomains).where(eq(orgDomains.orgId, org.id)).get()).toMatchObject({ catchAll: "yes" });
  });

  it("invalidates a rejected recipient", async () => {
    const { id } = setup();
    const result = await updateEmailCandidate(id, { action: "probe" }, {
      settings: enabled, mxResolver: mx,
      probe: vi.fn().mockResolvedValue({ outcome: "rejected", code: 550 }),
    });
    expect(result).toMatchObject({ status: "invalid", verificationMethod: "smtp_rcpt" });
  });

  it("records provider uncertainty without claiming verification", async () => {
    const { id } = setup();
    const result = await updateEmailCandidate(id, { action: "probe" }, {
      settings: enabled, mxResolver: mx,
      probe: vi.fn().mockResolvedValue({ outcome: "inconclusive", detail: "timeout" }),
    });
    expect(result).toMatchObject({ status: "uncertain", verificationMethod: null });
  });

  it("re-infers the company pattern after verifying a candidate on a mail alias", async () => {
    vi.stubEnv("SIGNALS_EMAIL_REINFER_AFTER_VERIFY", "1");
    const org = createOrg({ name: "Alias Co", domain: "alias.example" });
    addOrgDomainAlias(org.id, "mail.alias.example");
    const contact = createContact({ name: "Robert Taylor" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    const id = nanoid();
    db.insert(contactEmailCandidates).values({
      id, contactId: contact.id, orgId: org.id,
      address: "robert@mail.alias.example", addressNormalized: "robert@mail.alias.example",
      status: "predicted", confidence: "high", source: "enrich:email_pattern",
    }).run();

    await expect(updateEmailCandidate(id, { action: "verify" })).resolves.toMatchObject({
      status: "verified",
    });
    expect(db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, org.id)).all()[0]).toMatchObject({
      pattern: "{first}",
      matchCount: 1,
      sampleCount: 1,
      isSelected: true,
    });
  });

  it("does not re-infer after verify when the workspace setting is disabled", async () => {
    const { id } = setup();
    const reinfer = vi.fn();
    const settings = () => ({
      ...resolveEmailVerificationSettings(),
      reinferAfterVerify: {
        ...resolveEmailVerificationSettings().reinferAfterVerify,
        effectiveValue: false,
      },
    });
    await updateEmailCandidate(id, { action: "verify" }, { settings, reinfer });
    expect(reinfer).not.toHaveBeenCalled();
  });

  it("preserves a manual pattern override when verification triggers re-inference", async () => {
    vi.stubEnv("SIGNALS_EMAIL_REINFER_AFTER_VERIFY", "1");
    const org = createOrg({ name: "Override Co", domain: "override.example" });
    const contact = createContact({ name: "Robert Taylor" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    db.insert(orgEmailPatterns).values({
      id: nanoid(), orgId: org.id, pattern: "{first}.{last}", rank: 1,
      confidence: "low", score: 0, matchCount: 0, sampleCount: 0,
      isSelected: true, source: "manual:override", evaluatedAt: 1,
    }).run();
    const id = nanoid();
    db.insert(contactEmailCandidates).values({
      id, contactId: contact.id, orgId: org.id,
      address: "robert@override.example", addressNormalized: "robert@override.example",
      status: "predicted", confidence: "high", source: "enrich:email_pattern",
    }).run();

    await updateEmailCandidate(id, { action: "verify" });

    const patterns = db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, org.id)).all();
    expect(patterns.find((pattern) => pattern.source === "manual:override")).toMatchObject({
      pattern: "{first}.{last}",
      isSelected: true,
    });
    expect(patterns.find((pattern) => pattern.source === "inferred")).toMatchObject({
      pattern: "{first}",
      sampleCount: 1,
      isSelected: false,
    });
  });

  it("refreshes evidence without duplicating a matching manual pattern", async () => {
    vi.stubEnv("SIGNALS_EMAIL_REINFER_AFTER_VERIFY", "1");
    const org = createOrg({ name: "Matching Override Co", domain: "matching.example" });
    const contact = createContact({ name: "Robert Taylor" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    db.insert(orgEmailPatterns).values({
      id: nanoid(), orgId: org.id, pattern: "{first}", rank: 1,
      confidence: "low", score: 0, matchCount: 0, sampleCount: 0,
      isSelected: true, source: "manual:override", evaluatedAt: 1,
    }).run();
    const id = nanoid();
    db.insert(contactEmailCandidates).values({
      id, contactId: contact.id, orgId: org.id,
      address: "robert@matching.example", addressNormalized: "robert@matching.example",
      status: "predicted", confidence: "high", source: "enrich:email_pattern",
    }).run();

    await expect(updateEmailCandidate(id, { action: "verify" })).resolves.toMatchObject({
      status: "verified",
    });

    expect(db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, org.id)).all()).toEqual([
      expect.objectContaining({
        pattern: "{first}",
        source: "manual:override",
        sampleCount: 1,
        matchCount: 1,
        isSelected: true,
      }),
    ]);
  });
});
