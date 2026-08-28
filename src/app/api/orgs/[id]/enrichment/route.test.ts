import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";

describe("GET /api/orgs/[id]/enrichment", () => {
  beforeEach(() => resetCoreTables());

  it("returns idle state before the first enrichment", async () => {
    const org = createOrg({ name: "Idle Co" });
    const req = new NextRequest(`http://127.0.0.1:3000/api/orgs/${org.id}/enrichment`);
    const response = await GET(req, { params: Promise.resolve({ id: org.id }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "idle",
      workflowRunId: null,
    });
  });

  it("returns 404 for an unknown company", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/orgs/missing/enrichment");
    const response = await GET(req, { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
  });
});
