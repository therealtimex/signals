import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { contacts, contactChannels, contactIdentities } from "@/lib/db/schema";
import { ensureContactScalarColumns } from "@/lib/db/migrate-contact-scalars";
import { backfillChannels } from "@/lib/db/backfills/channels";
import { migrateContactIdentities } from "@/lib/db/migrate-identities";

function rawContact(id: string) {
  return db.select().from(contacts).where(eq(contacts.id, id)).get();
}

describe("startup migration sequence", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("preserves legacy scalars and backfills children in instrumentation order", () => {
    const contactId = nanoid();
    db.insert(contacts)
      .values({
        id: contactId,
        name: "Legacy Upgrade",
        platform: "x",
        platformUserId: "legacy-user",
        email: "legacy@example.com",
        phone: "+1 555 0100",
        verifiedEmail: 1,
        updatedAt: 123,
      })
      .run();

    const scalarRestore = ensureContactScalarColumns();
    expect(scalarRestore.restored).toEqual([]);
    expect(scalarRestore.projections).toBe(0);

    let row = rawContact(contactId);
    expect(row?.platform).toBe("x");
    expect(row?.platformUserId).toBe("legacy-user");
    expect(row?.email).toBe("legacy@example.com");
    expect(row?.phone).toBe("+1 555 0100");
    expect(row?.verifiedEmail).toBe(1);
    expect(row?.updatedAt).toBe(123);

    const channelBackfill = backfillChannels();
    expect(channelBackfill.emails).toBe(1);
    expect(channelBackfill.phones).toBe(1);

    row = rawContact(contactId);
    expect(row?.platform).toBe("x");
    expect(row?.platformUserId).toBe("legacy-user");
    expect(row?.email).toBe("legacy@example.com");
    expect(row?.phone).toBe("+1 555 0100");

    const identityMigration = migrateContactIdentities();
    expect(identityMigration.migrated).toBe(1);

    const channels = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contactId))
      .all();
    expect(channels).toHaveLength(2);

    const identities = db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, contactId))
      .all();
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({
      platform: "x",
      platformUserId: "legacy-user",
      isPrimary: 1,
    });

    row = rawContact(contactId);
    expect(row?.email).toBe("legacy@example.com");
    expect(row?.phone).toBe("+1 555 0100");
    expect(row?.platform).toBe("x");
    expect(row?.platformUserId).toBe("legacy-user");
  });
});
