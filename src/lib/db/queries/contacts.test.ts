import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  createContact,
  listContacts,
  updateContact,
  deleteContact,
  archiveContact,
  restoreContact,
  countContacts,
  countArchivedContacts,
} from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contacts queries", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a contact and parses first/last name", () => {
    const contact = createContact({
      name: "Ada Lovelace",
      platform: "x",
      platformUserId: "ada-1",
    });

    expect(contact.name).toBe("Ada Lovelace");
    expect(contact.firstName).toBe("Ada");
    expect(contact.lastName).toBe("Lovelace");
    expect(contact.enrichmentScore).toBeGreaterThan(0);
  });

  it("lists contacts with search filter", () => {
    createContact({ name: "Alpha", platform: "x", platformUserId: "a" });
    createContact({ name: "Beta", platform: "x", platformUserId: "b" });

    const result = listContacts({ search: "alp" });
    expect(result.total).toBe(1);
    expect(result.data[0]?.name).toBe("Alpha");
  });

  it("sorts contacts by enrichment score ascending", () => {
    const low = createContact({ name: "Low Score", platform: "x", platformUserId: "low" });
    const high = createContact({ name: "High Score", platform: "x", platformUserId: "high" });

    db.update(contacts).set({ enrichmentScore: 10 }).where(eq(contacts.id, low.id)).run();
    db.update(contacts).set({ enrichmentScore: 90 }).where(eq(contacts.id, high.id)).run();

    const result = listContacts({
      sort: "enrichmentScore",
      order: "asc",
      pageSize: 10,
    });

    expect(result.data[0]?.id).toBe(low.id);
    expect(result.data[1]?.id).toBe(high.id);
  });

  it("updates contact and recomputes display name from name parts", () => {
    const created = createContact({
      name: "Old Name",
      firstName: "Old",
      lastName: "Name",
      platform: "x",
      platformUserId: "u1",
    });

    const updated = updateContact(created.id, { firstName: "New", lastName: "Person" });
    expect(updated?.name).toBe("New Person");
  });

  it("archives and restores a contact", () => {
    const created = createContact({
      name: "Archive Me",
      platform: "x",
      platformUserId: "arch",
    });

    const archived = archiveContact(created.id, "inactive", "run-1");
    expect(JSON.parse(archived!.metadata!).archived).toBe(1);

    const visible = listContacts();
    expect(visible.total).toBe(0);

    const restored = restoreContact(created.id);
    expect(JSON.parse(restored!.metadata ?? "{}").archived).toBeUndefined();
    expect(listContacts().total).toBe(1);
  });

  it("deletes a contact", () => {
    const created = createContact({
      name: "Delete Me",
      platform: "x",
      platformUserId: "del",
    });

    expect(deleteContact(created.id)).toBe(true);
    expect(listContacts().total).toBe(0);
    expect(deleteContact(created.id)).toBe(false);
  });

  it("counts active and archived contacts", () => {
    createContact({
      name: "Active",
      platform: "x",
      platformUserId: "active",
    });
    const archived = createContact({
      name: "Archived",
      platform: "x",
      platformUserId: "archived",
    });

    archiveContact(archived.id, "test");

    expect(countContacts()).toBe(2);
    expect(countArchivedContacts()).toBe(1);
  });
});
