import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/contacts/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { db } from "@/lib/db/client";
import { contactIdentities, contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("POST /api/contacts identities[]", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates multiple identities and omits deprecated contacts.platform", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Multi Identity",
        platform: "x",
        identities: [
          {
            platform: "x",
            platformUserId: "x-user-1",
            platformHandle: "multi",
            isPrimary: true,
          },
          {
            platform: "linkedin",
            platformUserId: "li-user-1",
            platformUrl: "https://linkedin.com/in/multi",
          },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    expect("platform" in contact).toBe(false);
    expect(contact.identities).toHaveLength(2);

    const xIdentity = contact.identities.find(
      (identity: { platform: string }) => identity.platform === "x",
    );
    const linkedinIdentity = contact.identities.find(
      (identity: { platform: string }) => identity.platform === "linkedin",
    );

    expect(xIdentity?.platformUserId).toBe("x-user-1");
    expect(xIdentity?.isPrimary).toBe(1);
    expect(linkedinIdentity?.platformUrl).toBe("https://linkedin.com/in/multi");
    expect(linkedinIdentity?.isPrimary).toBe(0);
  });

  it("creates zero identities when identities[] is omitted", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Identities",
        platform: "linkedin",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    expect("platform" in contact).toBe(false);
    expect(contact.identities).toEqual([]);

    const rows = db.select().from(contactIdentities).all();
    expect(rows).toHaveLength(0);
  });

  it("still supports legacy single identity field", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Legacy Identity",
        identity: {
          platform: "gmail",
          platformUserId: "gmail-user-1",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    expect(contact.identities).toHaveLength(1);
    expect(contact.identities[0]).toMatchObject({
      platform: "gmail",
      platformUserId: "gmail-user-1",
      isPrimary: 1,
    });
  });

  it("defaults first identity as primary when none are marked", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Default Primary",
        identities: [
          { platform: "x", platformUserId: "x-1" },
          { platform: "substack", platformUserId: "ss-1" },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    const primary = contact.identities.find(
      (identity: { isPrimary: number }) => identity.isPrimary === 1,
    );
    expect(primary?.platform).toBe("x");
    expect(primary?.platformUserId).toBe("x-1");
  });

  it("rolls back contact and partial identities when a later identity conflicts", async () => {
    const existing = createContact({ name: "Existing Owner" });
    createIdentity({
      contactId: existing.id,
      platform: "x",
      platformUserId: "taken-user",
    });

    const contactsBefore = db.select().from(contacts).all().length;
    const identitiesBefore = db.select().from(contactIdentities).all().length;

    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Should Not Persist",
        identities: [
          { platform: "linkedin", platformUserId: "new-li-user" },
          { platform: "x", platformUserId: "taken-user" },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    expect(db.select().from(contacts).all()).toHaveLength(contactsBefore);
    expect(db.select().from(contactIdentities).all()).toHaveLength(identitiesBefore);
  });
});
