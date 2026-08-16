import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contacts.is_self", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("clears the previous owner when marking a new contact as self", () => {
    const first = createContact({ name: "First Owner", platform: "x", platformUserId: "o1" });
    const second = createContact({ name: "Second Owner", platform: "x", platformUserId: "o2" });

    updateContact(first.id, { isSelf: true });
    updateContact(second.id, { isSelf: true });

    const rows = db.select().from(contacts).where(eq(contacts.isSelf, true)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(second.id);

    const firstRow = db.select().from(contacts).where(eq(contacts.id, first.id)).get();
    expect(firstRow?.isSelf).toBe(false);
  });

  it("update_contact agent tool enforces single self contact", async () => {
    const first = createContact({ name: "Agent Owner A", platform: "x", platformUserId: "a1" });
    const second = createContact({ name: "Agent Owner B", platform: "x", platformUserId: "a2" });

    await invokeAgentTool("update_contact", { contactId: first.id, is_self: true });
    await invokeAgentTool("update_contact", { contactId: second.id, is_self: true });

    const selfRows = db.select().from(contacts).where(eq(contacts.isSelf, true)).all();
    expect(selfRows).toHaveLength(1);
    expect(selfRows[0]?.id).toBe(second.id);
  });
});
