import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/contacts/route";
import { PATCH, PUT } from "@/app/api/contacts/[id]/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { db } from "@/lib/db/client";
import { graphEdges, orgs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact org linking API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("POST /api/contacts links org via orgId and creates works_at edge", async () => {
    const org = createOrg({ name: "Acme Corp", source: "test" });

    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane Doe",
        orgId: org.id,
        title: "CEO",
        platform: "x",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    expect(contact.company).toBe("Acme Corp");
    expect(contact.title).toBe("CEO");

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe(org.id);
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CEO",
      is_current: true,
    });
  });

  it("POST /api/contacts honors explicit orgId when duplicate org names exist", async () => {
    db.insert(orgs)
      .values({
        id: "same-name-first",
        name: "Acme",
        orgType: "company",
        scope: "shared",
        source: "test",
      })
      .run();
    db.insert(orgs)
      .values({
        id: "same-name-selected",
        name: "Acme",
        orgType: "company",
        scope: "shared",
        source: "test",
      })
      .run();

    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Duplicate Name",
        orgId: "same-name-selected",
        platform: "x",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe("same-name-selected");
  });

  it("POST /api/contacts links org via company string", async () => {
    const req = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        company: "Beta LLC",
        title: "Engineer",
        platform: "x",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const contact = await res.json();
    expect(contact.company).toBe("Beta LLC");

    const org = db.select().from(orgs).where(eq(orgs.name, "Beta LLC")).get();
    expect(org).toBeDefined();

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe(org?.id);
  });

  it("PUT /api/contacts/[id] clears works_at when org is unlinked", async () => {
    const contact = createContact({
      name: "Leaver",
      company: "Acme Corp",
      platform: "x",
      platformUserId: "leaver-1",
    });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    db.insert(graphEdges)
      .values({
        id: "edge-1",
        srcType: "contact",
        srcId: contact.id,
        dstType: "org",
        dstId: org.id,
        edgeType: "works_at",
        properties: JSON.stringify({ title: "CEO", is_current: true }),
        scope: "shared",
        source: "test",
      })
      .run();

    const req = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "", company: "" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(200);

    const updated = await res.json();
    expect(updated.company).toBeNull();
    expect(db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all()).toHaveLength(0);
  });

  it("PATCH /api/contacts/[id] refreshes works_at title when only title changes", async () => {
    const contact = createContact({
      name: "Titled",
      company: "Acme Corp",
      title: "CEO",
      platform: "x",
      platformUserId: "titled-1",
    });
    const org = createOrg({ name: "Acme Corp", source: "test" });
    db.insert(graphEdges)
      .values({
        id: "edge-2",
        srcType: "contact",
        srcId: contact.id,
        dstType: "org",
        dstId: org.id,
        edgeType: "works_at",
        properties: JSON.stringify({ title: "CEO", is_current: true }),
        scope: "shared",
        source: "test",
      })
      .run();

    const req = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "CTO" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(200);

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CTO",
      is_current: true,
    });
  });

  it("PATCH /api/contacts/[id] preserves duplicate-name org link on title-only update", async () => {
    db.insert(orgs)
      .values({
        id: "same-name-first",
        name: "Acme",
        orgType: "company",
        scope: "shared",
        source: "test",
      })
      .run();
    db.insert(orgs)
      .values({
        id: "same-name-selected",
        name: "Acme",
        orgType: "company",
        scope: "shared",
        source: "test",
      })
      .run();

    const createReq = new NextRequest("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Duplicate Name",
        orgId: "same-name-selected",
        title: "CEO",
        platform: "x",
      }),
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);
    const contact = await createRes.json();

    const worksAtBefore = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAtBefore[0]?.dstId).toBe("same-name-selected");

    const patchReq = new NextRequest(`http://localhost/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "CTO" }),
    });
    const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: contact.id }) });
    expect(patchRes.status).toBe(200);

    const worksAt = db.select().from(graphEdges).where(eq(graphEdges.edgeType, "works_at")).all();
    expect(worksAt).toHaveLength(1);
    expect(worksAt[0]?.dstId).toBe("same-name-selected");
    expect(JSON.parse(worksAt[0]?.properties ?? "{}")).toMatchObject({
      title: "CTO",
      is_current: true,
    });
  });
});
