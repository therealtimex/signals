import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { contactChannels } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import { repairChannelPrimaries } from "./channel-primaries";

/** The write path demotes siblings, so the pre-#534 merge damage is planted directly. */
function forcePrimary(ids: string[]): void {
  const update = sqlite.prepare("UPDATE contact_channels SET is_primary = 1 WHERE id = ?");
  for (const id of ids) update.run(id);
}

function primaryIds(contactId: string, channelType: string): string[] {
  return db
    .select({ id: contactChannels.id })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, contactId),
        eq(contactChannels.channelType, channelType),
        eq(contactChannels.isPrimary, true),
      ),
    )
    .all()
    .map((row) => row.id);
}

function email(contactId: string, value: string, isVerified = false) {
  return createContactChannel({ contactId, channelType: "email", value, isVerified, source: "test" });
}

describe("repairChannelPrimaries", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("keeps the verified primary, demotes the rest, and is a no-op on the second run", () => {
    const contact = createContact({ name: "Takeout Survivor" });
    const a = email(contact.id, "a@example.com");
    const verified = email(contact.id, "b@example.com", true);
    const c = email(contact.id, "c@example.com");
    forcePrimary([a.id, verified.id, c.id]);

    expect(repairChannelPrimaries()).toEqual({ contacts: 1, demoted: 2 });
    expect(primaryIds(contact.id, "email")).toEqual([verified.id]);
    expect(repairChannelPrimaries()).toEqual({ contacts: 0, demoted: 0 });
  });

  it("keeps the first-inserted primary when none is verified", () => {
    const contact = createContact({ name: "Unverified Survivor" });
    const first = email(contact.id, "first@example.com");
    const second = email(contact.id, "second@example.com");
    forcePrimary([first.id, second.id]);

    expect(repairChannelPrimaries()).toEqual({ contacts: 1, demoted: 1 });
    expect(primaryIds(contact.id, "email")).toEqual([first.id]);
  });

  it("leaves contacts that already hold one primary per type untouched", () => {
    const contact = createContact({ name: "Healthy Contact" });
    const mail = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "ok@example.com",
      isPrimary: true,
      source: "test",
    });
    const phone = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+84913039986",
      isPrimary: true,
      source: "test",
    });

    expect(repairChannelPrimaries()).toEqual({ contacts: 0, demoted: 0 });
    expect(primaryIds(contact.id, "email")).toEqual([mail.id]);
    expect(primaryIds(contact.id, "phone")).toEqual([phone.id]);
  });
});
