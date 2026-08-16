import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createContact } from "@/lib/db/queries/contacts";
import { logInteraction } from "@/lib/db/queries/interactions";
import { GET } from "@/app/api/contacts/[id]/timeline/route";
import { POST } from "@/app/api/contacts/[id]/interactions/route";
import { resetCoreTables } from "@/test/db";

describe("contact timeline API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns timeline items for a contact", async () => {
    const contact = createContact({ name: "API", platform: "x", platformUserId: "api-1" });
    logInteraction({
      contactId: contact.id,
      interactionType: "note",
      summary: "Follow up next week",
      source: "test",
    });

    const res = await GET(new NextRequest(`http://localhost/api/contacts/${contact.id}/timeline`), {
      params: Promise.resolve({ id: contact.id }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      eventType: "note",
      summary: "Follow up next week",
      kind: "interaction",
    });
  });

  it("creates manual interactions via POST", async () => {
    const contact = createContact({ name: "Manual", platform: "x", platformUserId: "manual-1" });

    const res = await POST(
      new NextRequest(`http://localhost/api/contacts/${contact.id}/interactions`, {
        method: "POST",
        body: JSON.stringify({
          interactionType: "call",
          summary: "Quick sync",
        }),
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      interactionType: "call",
      attachmentCount: 0,
    });
  });
});
