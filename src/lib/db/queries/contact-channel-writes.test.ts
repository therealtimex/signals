import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, updateContact, getContactById } from "@/lib/db/queries/contacts";
import {
  applyLegacyEmailPhone,
  ensureContactChannel,
  syncChannelInputs,
  ChannelWriteError,
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

    const row = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(row?.email).toBeNull();
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

  it("updates channels in place and preserves server-owned fields", () => {
    const contact = createContact({ name: "Ada" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "work@example.com",
      isPrimary: true,
      isVerified: true,
      scope: "local_only",
      source: "sync:private",
      metadata: { provenance: "kept" },
    });

    syncChannelInputs(
      contact.id,
      [
        {
          id: channel.id,
          channelType: "email",
          value: "work@example.com",
          label: "Work inbox",
          isPrimary: true,
        },
      ],
      "api:update_contact",
    );

    const refreshed = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.id, channel.id))
      .get();
    expect(refreshed?.id).toBe(channel.id);
    expect(refreshed?.label).toBe("Work inbox");
    expect(refreshed?.scope).toBe("local_only");
    expect(refreshed?.source).toBe("sync:private");
    expect(refreshed?.metadata).toBe(JSON.stringify({ provenance: "kept" }));
  });

  it("rejects a foreign contact channel id during sync", () => {
    const owner = createContact({ name: "Owner" });
    const other = createContact({ name: "Other" });
    const foreign = createContactChannel({
      contactId: other.id,
      channelType: "email",
      value: "foreign@example.com",
      source: "test",
    });

    expect(() =>
      syncChannelInputs(
        owner.id,
        [{ id: foreign.id, channelType: "email", value: "foreign@example.com" }],
        "test",
      ),
    ).toThrow(ChannelWriteError);
  });

  it("does not delete channels when sync validation fails", () => {
    const contact = createContact({ name: "Ada" });
    const work = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "work@example.com",
      source: "test",
    });
    const personal = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "personal@example.com",
      source: "test",
    });

    expect(() =>
      syncChannelInputs(
        contact.id,
        [{ id: work.id, channelType: "phone", value: "work@example.com" }],
        "test",
      ),
    ).toThrow(ChannelWriteError);

    const ids = db
      .select({ id: contactChannels.id })
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contact.id))
      .all()
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual([personal.id, work.id].sort());
  });
});
