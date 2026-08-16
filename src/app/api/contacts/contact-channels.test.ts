import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/contacts/route";
import { PUT } from "@/app/api/contacts/[id]/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { DEPRECATED_PLATFORM_FIELDS_MESSAGE } from "@/lib/api/contact-route-validation";
import { resetCoreTables } from "@/test/db";

describe("contact channels API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("round-trips multiple channels on create and update", async () => {
    const createReq = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Channel Owner",
        channels: [
          { channelType: "email", value: "work@example.com", isPrimary: true },
          { channelType: "email", value: "personal@example.com" },
          { channelType: "phone", value: "+1 (555) 111-2222", isPrimary: true },
        ],
      }),
    });

    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.channels).toHaveLength(3);
    expect(created.primaryEmail).toBe("work@example.com");
    expect(created.email).toBe("work@example.com");
    expect(created.primaryPhone).toBe("+1 (555) 111-2222");

    const personal = created.channels.find(
      (c: { value: string }) => c.value === "personal@example.com",
    );
    const phone = created.channels.find(
      (c: { channelType: string }) => c.channelType === "phone",
    );

    const updateReq = new NextRequest(`http://localhost/api/contacts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channels: [
          {
            id: personal.id,
            channelType: "email",
            value: "personal@example.com",
            isPrimary: true,
          },
          {
            id: phone.id,
            channelType: "phone",
            value: "+1 (555) 111-2222",
            isPrimary: true,
          },
        ],
      }),
    });

    const updateRes = await PUT(updateReq, { params: Promise.resolve({ id: created.id }) });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.channels).toHaveLength(2);
    expect(updated.primaryEmail).toBe("personal@example.com");
    expect(updated.channels.find((c: { id: string }) => c.id === personal.id)).toBeTruthy();
    expect(updated.channels.find((c: { id: string }) => c.id === phone.id)).toBeTruthy();

    const listRes = await GET(new NextRequest("http://localhost/api/contacts?search=Channel"));
    const listed = await listRes.json();
    expect(listed.data[0]?.channelCount).toBe(2);
  });

  it("preserves channel ids and server-owned provenance on label-only edits", async () => {
    const contact = createContact({ name: "Provenance Owner" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "private@example.com",
      isPrimary: true,
      isVerified: true,
      scope: "local_only",
      source: "sync:private",
      metadata: { provenance: "kept" },
    });

    const updateReq = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channels: [
          {
            id: channel.id,
            channelType: "email",
            value: "private@example.com",
            label: "Private inbox",
            isPrimary: true,
          },
        ],
      }),
    });

    const updateRes = await PUT(updateReq, { params: Promise.resolve({ id: contact.id }) });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    const refreshed = updated.channels[0];
    expect(refreshed.id).toBe(channel.id);
    expect(refreshed.label).toBe("Private inbox");
    expect(refreshed.scope).toBe("local_only");
    expect(refreshed.source).toBe("sync:private");
    expect(refreshed.metadata).toBe(JSON.stringify({ provenance: "kept" }));
  });

  it("rejects a foreign contact channel id", async () => {
    const owner = createContact({ name: "Owner" });
    const other = createContact({ name: "Other" });
    const foreign = createContactChannel({
      contactId: other.id,
      channelType: "email",
      value: "foreign@example.com",
      source: "test",
    });

    const updateReq = new NextRequest(`http://localhost/api/contacts/${owner.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channels: [
          {
            id: foreign.id,
            channelType: "email",
            value: "foreign@example.com",
            isPrimary: true,
          },
        ],
      }),
    });

    const updateRes = await PUT(updateReq, { params: Promise.resolve({ id: owner.id }) });
    expect(updateRes.status).toBe(400);
  });

  it("shims legacy email on create into channels", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Legacy Shim",
        email: "legacy@example.com",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const contact = await res.json();
    expect(contact.email).toBe("legacy@example.com");
    expect(contact.channels).toHaveLength(1);
    expect(contact.channels[0].valueNormalized).toBe("legacy@example.com");
  });

  it("rejects deprecated platform fields on create", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Platform Shim",
        platform: "x",
        platformUserId: "user-1",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(DEPRECATED_PLATFORM_FIELDS_MESSAGE);
  });

  it("rejects deprecated platform fields on update", async () => {
    const contact = createContact({ name: "Existing" });
    const req = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "linkedin",
        platformUserId: "in-1",
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(DEPRECATED_PLATFORM_FIELDS_MESSAGE);
  });
});
