import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/contacts/route";
import { PATCH } from "@/app/api/contacts/[id]/route";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contacts REST isSelf", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("POST with isSelf true swaps owners", async () => {
    const first = createContact({ name: "First", platform: "x", platformUserId: "a" });
    updateContact(first.id, { isSelf: true });

    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second",
        isSelf: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isSelf).toBe(true);
    expect(db.select().from(contacts).where(eq(contacts.isSelf, true)).all()).toHaveLength(1);
  });

  it("PATCH with isSelf true swaps owners", async () => {
    const first = createContact({ name: "First", platform: "x", platformUserId: "a" });
    const second = createContact({ name: "Second", platform: "x", platformUserId: "b" });
    updateContact(first.id, { isSelf: true });

    const req = new NextRequest(`http://localhost/api/contacts/${second.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSelf: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: second.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSelf).toBe(true);
    expect(db.select().from(contacts).where(eq(contacts.id, first.id)).get()?.isSelf).toBe(false);
  });

  it("PATCH with isSelf false clears the owner", async () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "a" });
    updateContact(owner.id, { isSelf: true });

    const req = new NextRequest(`http://localhost/api/contacts/${owner.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSelf: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: owner.id }) });
    expect(res.status).toBe(200);
    expect(db.select().from(contacts).where(eq(contacts.isSelf, true)).all()).toHaveLength(0);
  });

  it("rejects invalid isSelf type", async () => {
    const contact = createContact({ name: "Owner", platform: "x", platformUserId: "a" });
    const req = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSelf: "yes" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(400);
  });
});
