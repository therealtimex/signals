import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, updateContact, getContactById } from "@/lib/db/queries/contacts";
import {
  applyLegacyEmailPhone,
  ensureContactChannel,
} from "@/lib/db/queries/contact-channel-writes";
import {
  createContactChannel,
  resolvePrimaryChannel,
} from "@/lib/db/queries/contact-channels";
import { db } from "@/lib/db/client";
import { contactChannels, contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact-channel-writes", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("preserves verified state when legacy email is re-sent without verifiedEmail", () => {
    const contact = createContact({ name: "Ada", email: "ada@example.com", verifiedEmail: 1 });
    const primary = resolvePrimaryChannel(contact.id, "email");
    expect(primary?.isVerified).toBe(true);

    updateContact(contact.id, { email: "ada@example.com" });

    const refreshed = resolvePrimaryChannel(contact.id, "email");
    expect(refreshed?.isVerified).toBe(true);
  });

  it("clears primary email when legacy email is set to empty string", () => {
    const contact = createContact({ name: "Ada", email: "ada@example.com" });
    expect(resolvePrimaryChannel(contact.id, "email")?.value).toBe("ada@example.com");

    updateContact(contact.id, { email: "" });

    expect(resolvePrimaryChannel(contact.id, "email")).toBeUndefined();
    expect(getContactById(contact.id)?.email).toBeNull();
  });

  it("recalculates enrichment when a verified email channel is added directly", () => {
    const contact = createContact({ name: "Ada" });
    expect(contact.enrichmentScore).toBe(0);

    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "ada@example.com",
      isPrimary: true,
      isVerified: true,
      source: "test",
    });

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.enrichmentScore).toBeGreaterThan(0);
  });

  it("normalizes phone values through ensureContactChannel", () => {
    const contact = createContact({ name: "Ada" });
    ensureContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+1 (555) 123-4567",
      isPrimary: true,
      source: "test",
    });

    const channel = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contact.id))
      .get();
    expect(channel?.valueNormalized).toBe("+15551234567");
  });

  it("applies verifiedEmail-only updates to the primary email channel", () => {
    const contact = createContact({ name: "Ada", email: "ada@example.com" });
    applyLegacyEmailPhone(contact.id, { verifiedEmail: 1 }, "test");

    expect(resolvePrimaryChannel(contact.id, "email")?.isVerified).toBe(true);
  });
});
