import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { db, sqlite } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { contactIdentities } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

const MIGRATION_SQL = readFileSync(
  new URL("./migrations/0029_normalize_platform_handle_sigil.sql", import.meta.url),
  "utf8",
);

/** Run the shipped migration itself rather than a hand-copied version of its SQL. */
function runMigration(): void {
  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

function seedIdentity(platform: string, platformHandle: string | null): string {
  const contact = createContact({ name: `Subject ${platformHandle ?? "none"}` });
  const id = nanoid();
  db.insert(contactIdentities)
    .values({
      id,
      contactId: contact.id,
      platform: platform as "x",
      platformUserId: nanoid(),
      platformHandle,
      isActive: 1,
    })
    .run();
  return id;
}

function handleOf(id: string): string | null {
  return db
    .select({ platformHandle: contactIdentities.platformHandle })
    .from(contactIdentities)
    .where(eq(contactIdentities.id, id))
    .get()?.platformHandle ?? null;
}

describe("0029_normalize_platform_handle_sigil", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("strips X sigils, repairs doubled ones, and leaves bare handles alone", () => {
    const single = seedIdentity("x", "@sama");
    const doubled = seedIdentity("x", "@@chickadeedee3");
    const bare = seedIdentity("x", "AndrewYNg");

    runMigration();

    expect(handleOf(single)).toBe("sama");
    expect(handleOf(doubled)).toBe("chickadeedee3");
    expect(handleOf(bare)).toBe("AndrewYNg");
  });

  it("never rewrites a platform that does not use the sigil", () => {
    const gmail = seedIdentity("gmail", "+bui.viet.hien@undp.org");
    const linkedin = seedIdentity("linkedin", "nguyen-k-phung-cfa");

    runMigration();

    expect(handleOf(gmail)).toBe("+bui.viet.hien@undp.org");
    expect(handleOf(linkedin)).toBe("nguyen-k-phung-cfa");
  });

  it("nulls a handle that was nothing but a sigil rather than storing an empty string", () => {
    const sigilOnly = seedIdentity("x", "@");

    runMigration();

    expect(handleOf(sigilOnly)).toBeNull();
  });

  it("is idempotent — a second run changes nothing", () => {
    const single = seedIdentity("x", "@sama");

    runMigration();
    const afterFirst = handleOf(single);
    runMigration();

    expect(handleOf(single)).toBe(afterFirst);
    expect(handleOf(single)).toBe("sama");
  });
});
