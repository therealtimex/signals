import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/contacts/[id]/explore/route";
import { createContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { contactPersonas } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { resetCoreTables } from "@/test/db";

describe("GET /api/contacts/[id]/explore", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns 404 for unknown contact", async () => {
    const res = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Contact not found", code: "NOT_FOUND" });
  });

  it("returns explore payload for seeded contact", async () => {
    const contact = createContact({ name: "API", platform: "x", platformUserId: "api-1" });
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        summary: "API persona",
        scope: "shared",
      })
      .run();

    const res = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: contact.id }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.persona.visibility).toBe("shared");
    expect(body.persona.summary).toBe("API persona");
    expect(body.identities).toEqual([]);
  });
});
