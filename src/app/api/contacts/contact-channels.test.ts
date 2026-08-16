import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/contacts/route";
import { PUT } from "@/app/api/contacts/[id]/route";
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

    const updateReq = new NextRequest(`http://localhost/api/contacts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channels: [
          {
            id: created.channels.find((c: { value: string }) => c.value === "personal@example.com").id,
            channelType: "email",
            value: "personal@example.com",
            isPrimary: true,
          },
          {
            id: created.channels.find((c: { channelType: string }) => c.channelType === "phone").id,
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

    const listRes = await GET(new NextRequest("http://localhost/api/contacts?search=Channel"));
    const listed = await listRes.json();
    expect(listed.data[0]?.channelCount).toBe(2);
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
});
