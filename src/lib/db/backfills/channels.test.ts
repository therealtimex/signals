import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import {
  backfillChannels,
  countEmailChannels,
  countScalarEmailsMissingChannel,
  countScalarPhonesMissingChannel,
} from "@/lib/db/backfills/channels";
import { findContactByChannel } from "@/lib/db/queries/contact-channels";

describe("backfillChannels", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("is idempotent and preserves normalized phone dedup keys", () => {
    const contactId = nanoid();
    db.insert(contacts)
      .values({
        id: contactId,
        name: "Legacy Phone",
        email: "legacy@example.com",
        phone: "+1 (555) 123-4567",
        verifiedEmail: 1,
      })
      .run();

    const first = backfillChannels();
    const second = backfillChannels();

    expect(first.emails).toBe(1);
    expect(first.phones).toBe(1);
    expect(second.emails).toBe(0);
    expect(second.phones).toBe(0);
    expect(countEmailChannels()).toBe(1);
    expect(countScalarEmailsMissingChannel()).toBe(0);
    expect(countScalarPhonesMissingChannel()).toBe(0);
    expect(findContactByChannel("phone", "+1 (555) 123-4567")?.id).toBe(contactId);
  });
});
