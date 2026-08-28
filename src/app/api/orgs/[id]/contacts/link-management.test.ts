import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { DELETE } from "./[contactId]/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { db } from "@/lib/db/client";
import { contactEmployments, graphEdges } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("company people link management", () => {
  beforeEach(() => resetCoreTables());

  it("creates and removes the employment and works_at projection together", async () => {
    const org = createOrg({ name: "Link Co" });
    const contact = createContact({ name: "Person" });
    const createResponse = await POST(
      new NextRequest(`http://localhost/api/orgs/${org.id}/contacts`, {
        method: "POST",
        body: JSON.stringify({ contactId: contact.id, title: "VP" }),
      }),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(createResponse.status).toBe(201);
    expect(db.select().from(contactEmployments).all()).toHaveLength(1);
    expect(db.select().from(graphEdges).all().filter((edge) => edge.edgeType === "works_at")).toHaveLength(1);

    const deleteResponse = await DELETE(
      new NextRequest(`http://localhost/api/orgs/${org.id}/contacts/${contact.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: org.id, contactId: contact.id }) },
    );
    expect(deleteResponse.status).toBe(204);
    expect(db.select().from(contactEmployments).all()).toHaveLength(0);
    expect(db.select().from(graphEdges).all().filter((edge) => edge.edgeType === "works_at")).toHaveLength(0);
  });
});
