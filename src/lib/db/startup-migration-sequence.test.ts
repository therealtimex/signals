import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { contactChannels } from "@/lib/db/schema";
import { backfillChannels } from "@/lib/db/backfills/channels";

describe("startup migration sequence", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("keeps channel backfill idempotent in the live app database", () => {
    const contact = createContact({ name: "Live" });
    db.insert(contactChannels)
      .values({
        id: nanoid(),
        contactId: contact.id,
        channelType: "email",
        value: "live@example.com",
        valueNormalized: "live@example.com",
        isPrimary: true,
        source: "test",
      })
      .run();

    const second = backfillChannels();
    expect(second.emails).toBe(0);
    expect(second.phones).toBe(0);

    const channels = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contact.id))
      .all();
    expect(channels).toHaveLength(1);
  });
});
