import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, archiveContact, getContactById } from "@/lib/db/queries/contacts";
import {
  createContactChannel,
  deleteContactChannel,
  findContactByChannel,
  listContactChannels,
  resolvePrimaryChannel,
  updateContactChannel,
} from "@/lib/db/queries/contact-channels";
import { db } from "@/lib/db/client";
import { contactChannels } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact-channels", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a channel with server-side normalization", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "  Ada@Example.COM ",
      source: "manual",
    });

    expect(channel.value).toBe("Ada@Example.COM");
    expect(channel.valueNormalized).toBe("ada@example.com");
  });

  it("enforces one primary per contact and channel type", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada" });
    const first = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "work@example.com",
      isPrimary: true,
      source: "manual",
    });
    const second = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "personal@example.com",
      isPrimary: true,
      source: "manual",
    });

    const refreshedFirst = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.id, first.id))
      .get();
    expect(refreshedFirst?.isPrimary).toBe(false);
    expect(second.isPrimary).toBe(true);
    expect(resolvePrimaryChannel(contact.id, "email")?.id).toBe(second.id);
  });

  it("finds contacts by normalized channel value", () => {
    const contact = createContact({ name: "Importer Target", platform: "gmail", platformUserId: "g1" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "target@example.com",
      source: "manual",
    });

    const match = findContactByChannel("email", "TARGET@example.com");
    expect(match?.id).toBe(contact.id);
  });

  it("does not match archived contacts", () => {
    const contact = createContact({ name: "Archived", platform: "gmail", platformUserId: "g2" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "archived@example.com",
      source: "manual",
    });
    archiveContact(contact.id, "test");

    expect(findContactByChannel("email", "archived@example.com")).toBeUndefined();
  });

  it("prefers an active contact when an archived contact shares the same email", () => {
    const archived = createContact({ name: "Archived Owner", email: "shared@example.com" });
    archiveContact(archived.id, "test");

    const active = createContact({ name: "Active Owner" });
    createContactChannel({
      contactId: active.id,
      channelType: "email",
      value: "shared@example.com",
      isVerified: true,
      source: "manual",
    });

    const match = findContactByChannel("email", "shared@example.com");
    expect(match?.id).toBe(active.id);
    expect(getContactById(active.id)?.email).toBe("shared@example.com");
  });

  it("updates value and recomputes normalized key", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+1 (555) 111-2222",
      source: "manual",
    });

    const updated = updateContactChannel(channel.id, { value: "+1 (555) 333-4444" });
    expect(updated?.valueNormalized).toBe("+15553334444");
  });

  it("rejects duplicate normalized values on the same contact", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "same@example.com",
      source: "manual",
    });

    expect(() =>
      createContactChannel({
        contactId: contact.id,
        channelType: "email",
        value: "SAME@example.com",
        source: "manual",
      }),
    ).toThrow();
  });

  it("deletes a channel", () => {
    const contact = createContact({ name: "Ada", platform: "x", platformUserId: "ada" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "delete-me@example.com",
      source: "manual",
    });

    expect(deleteContactChannel(channel.id)).toBe(true);
    expect(listContactChannels(contact.id)).toHaveLength(0);
  });
});
