import { beforeEach, describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { createContact } from "@/lib/db/queries/contacts";
import { POST } from "@/app/api/contacts/[id]/identities/route";
import { resetCoreTables } from "@/test/db";

describe("POST /api/contacts/[id]/identities", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("accepts registry platforms such as instagram", async () => {
    const contact = createContact({
      name: "Creator",
      platform: "x",
      platformUserId: "creator-1",
    });

    const req = new NextRequest(`http://localhost/api/contacts/${contact.id}/identities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "instagram",
        platformUserId: "ig-user-42",
        platformHandle: "@creator",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(201);

    const identity = await res.json();
    expect(identity.platform).toBe("instagram");
    expect(identity.platformUserId).toBe("ig-user-42");
  });
});
