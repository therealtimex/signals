import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactEmailCandidates, orgDomains } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
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
});
