import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { migrateIdentityStats } from "@/lib/db/migrate-identity-stats";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("migrateIdentityStats", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("lifts stats from platform_data into typed columns", () => {
    const contact = createContact({ name: "Stats Subject", platform: "x", platformUserId: "s1" });
    db.insert(contactIdentities)
      .values({
        id: nanoid(),
        contactId: contact.id,
        platform: "x",
        platformUserId: nanoid(),
        platformData: JSON.stringify({
          followers_count: 999,
          following_count: 100,
          tweet_count: 50,
          verified: true,
        }),
        isPrimary: 1,
        isActive: 1,
      })
      .run();

    const result = migrateIdentityStats();
    expect(result.migrated).toBe(1);

    const rerun = migrateIdentityStats();
    expect(rerun.migrated).toBe(0);
  });
});
