import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { resetCoreTables } from "@/test/db";
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
    createContact({
      name: "Legacy Phone",
      email: "legacy@example.com",
      phone: "+1 (555) 123-4567",
      verifiedEmail: 1,
    });

    const first = backfillChannels();
    const second = backfillChannels();

    expect(first.emails).toBe(0);
    expect(first.phones).toBe(0);
    expect(second.emails).toBe(0);
    expect(second.phones).toBe(0);
    expect(countEmailChannels()).toBe(1);
    expect(countScalarEmailsMissingChannel()).toBe(0);
    expect(countScalarPhonesMissingChannel()).toBe(0);
    expect(findContactByChannel("phone", "+1 (555) 123-4567")?.name).toBe("Legacy Phone");
  });
});
