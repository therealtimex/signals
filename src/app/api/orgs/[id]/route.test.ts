import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createOrg } from "@/lib/db/queries/orgs";
import { PATCH } from "@/app/api/orgs/[id]/route";
import { resetCoreTables } from "@/test/db";

describe("PATCH /api/orgs/[id]", () => {
  beforeEach(() => resetCoreTables());

  it("updates and returns the shared company DTO", async () => {
    const org = createOrg({ name: "Acme" });
    const response = await PATCH(
      new NextRequest(`http://localhost/api/orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ domain: "https://www.Acme.com", updatedVia: "manual" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: org.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: org.id,
      domain: "acme.com",
      completeness: { missing: expect.any(Array) },
      provenance: { label: "Manually added" },
    });
  });

  it("returns actionable domain validation and immutable-provenance errors", async () => {
    const org = createOrg({ name: "Acme" });
    const invalid = await PATCH(
      new NextRequest(`http://localhost/api/orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ domain: "acme" }),
      }),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "domain", code: "NO_TLD" },
    });

    const immutable = await PATCH(
      new NextRequest(`http://localhost/api/orgs/${org.id}`, {
        method: "PATCH",
        body: JSON.stringify({ createdSource: "agent" }),
      }),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(immutable.status).toBe(400);
    await expect(immutable.json()).resolves.toMatchObject({ code: "IMMUTABLE_PROVENANCE" });
  });
});
