import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/explore/map/route";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { resetCoreTables } from "@/test/db";
import { nanoid } from "nanoid";

describe("GET /api/explore/map", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns explore map shape for seeded graph", async () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: nanoid() });
    updateContact(owner.id, { isSelf: true });
    const follower = createContact({ name: "Follower", platform: "x", platformUserId: nanoid() });
    upsertGraphEdge({
      srcType: "contact",
      srcId: follower.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });

    const res = await GET(new NextRequest("http://localhost/api/explore/map"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.ownerContactId).toBe(owner.id);
    expect(body.nodes.some((node: { id: string }) => node.id === `contact:${owner.id}`)).toBe(true);
    expect(body.nodes.some((node: { id: string }) => node.id === `contact:${follower.id}`)).toBe(
      true,
    );
    expect(Array.isArray(body.edges)).toBe(true);
  });

  it("returns 400 VALIDATION_ERROR for invalid limit", async () => {
    for (const url of [
      "http://localhost/api/explore/map?limit=0",
      "http://localhost/api/explore/map?limit=501",
      "http://localhost/api/explore/map?limit=abc",
    ]) {
      const res = await GET(new NextRequest(url));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns 200 empty when no owner is configured", async () => {
    const res = await GET(new NextRequest("http://localhost/api/explore/map"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meta.ownerContactId).toBeNull();
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });
});
