import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { createIdentity } from "@/lib/db/queries/identities";
import { backfillChannels } from "@/lib/db/backfills/channels";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function rawContact(id: string) {
  return db.select().from(contacts).where(eq(contacts.id, id)).get();
}

describe("contact-scalar-projection", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("projects email, phone, and verified_email to the contacts row on create", () => {
    const contact = createContact({
      name: "Ada",
      email: "ada@example.com",
      phone: "+1 555 123 4567",
      verifiedEmail: 1,
    });

    const row = rawContact(contact.id);
    expect(row?.email).toBe("ada@example.com");
    expect(row?.phone).toBe("+1 555 123 4567");
    expect(row?.verifiedEmail).toBe(1);
  });

  it("projects platform scalars from the primary identity", () => {
    const contact = createContact({ name: "Ada" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "ada-handle",
      isPrimary: 1,
    });

    const row = rawContact(contact.id);
    expect(row?.platform).toBe("x");
    expect(row?.platformUserId).toBe("ada-handle");
  });

  it("projects scalars when channels are created directly", () => {
    const contact = createContact({ name: "Ada" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "direct@example.com",
      isPrimary: true,
      isVerified: true,
      source: "test",
    });

    const row = rawContact(contact.id);
    expect(row?.email).toBe("direct@example.com");
    expect(row?.verifiedEmail).toBe(1);
  });

  it("clears scalar email when legacy email is cleared and backfill does not resurrect it", () => {
    const contact = createContact({ name: "Upgraded", email: "resurrected@example.com" });
    expect(rawContact(contact.id)?.email).toBe("resurrected@example.com");

    updateContact(contact.id, { email: "" });
    expect(rawContact(contact.id)?.email).toBeNull();

    const backfill = backfillChannels();
    expect(backfill.emails).toBe(0);
    expect(rawContact(contact.id)?.email).toBeNull();
  });
});
