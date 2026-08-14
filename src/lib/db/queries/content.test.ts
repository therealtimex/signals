import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createContentItem, deleteContentItem } from "@/lib/db/queries/content";
import { logInteraction } from "@/lib/db/queries/interactions";
import { db } from "@/lib/db/client";
import { contentItems, interactions } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("content queries", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(interactions).run();
    db.delete(contentItems).run();
  });

  it("deleteContentItem succeeds when interactions reference the content item", () => {
    const contact = createContact({ name: "Reader", platform: "x", platformUserId: "r1" });
    const item = createContentItem({
      contentType: "post",
      status: "imported",
    });

    const interaction = logInteraction({
      contactId: contact.id,
      interactionType: "like",
      contentItemId: item.id,
      scope: "shared",
      source: "test",
    });

    expect(deleteContentItem(item.id)).toBe(true);
    expect(db.select().from(contentItems).all()).toHaveLength(0);

    const row = db.select().from(interactions).where(eq(interactions.id, interaction.id)).get();
    expect(row).toBeTruthy();
    expect(row?.contentItemId).toBeNull();
  });
});
