import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import {
  archiveContact,
  createContact,
  getOwnerContactId,
  restoreContact,
  updateContact,
} from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contacts.is_self", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("createContact with isSelf true swaps the existing owner", () => {
    const first = createContact({ name: "First Owner", platform: "x", platformUserId: "o1" });
    updateContact(first.id, { isSelf: true });

    const second = createContact({
      name: "Second Owner",
      platform: "x",
      platformUserId: "o2",
      isSelf: true,
    });

    const rows = db.select().from(contacts).where(eq(contacts.isSelf, true)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(second.id);
    expect(getOwnerContactId()).toBe(second.id);
  });

  it("clears the owner when isSelf is set to false", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "o1" });
    updateContact(owner.id, { isSelf: true });
    updateContact(owner.id, { isSelf: false });

    expect(db.select().from(contacts).where(eq(contacts.isSelf, true)).all()).toHaveLength(0);
    expect(getOwnerContactId()).toBeNull();
  });

  it("archiveContact clears is_self and restore does not re-set it", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "o1" });
    updateContact(owner.id, { isSelf: true });

    archiveContact(owner.id, "test archive");
    expect(db.select().from(contacts).where(eq(contacts.id, owner.id)).get()?.isSelf).toBe(false);

    restoreContact(owner.id);
    expect(db.select().from(contacts).where(eq(contacts.id, owner.id)).get()?.isSelf).toBe(false);
    expect(getOwnerContactId()).toBeNull();
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
