import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createContact } from "@/lib/db/queries/contacts";
import { dualWriteContactCompany } from "@/lib/db/contact-org-dual-write";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  countOrgLinkedContacts,
  createOrg,
  listOrgLinkedContacts,
  listOrgsWithContactCounts,
} from "@/lib/db/queries/orgs";
import { GET as listOrgs, POST as createOrgRoute } from "@/app/api/orgs/route";
import { GET as getOrg } from "@/app/api/orgs/[id]/route";
import { GET as listOrgContacts } from "@/app/api/orgs/[id]/contacts/route";
import { resetCoreTables } from "@/test/db";

describe("orgs queries and API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates orgs and lists them with contact counts", () => {
    const org = createOrg({ name: "Acme Corp", domain: "acme.com", source: "test" });
    const contact = createContact({ name: "Jordan Lee", company: "Acme Corp" });
    dualWriteContactCompany(contact.id, "Acme Corp", "Engineer");

    const listed = listOrgsWithContactCounts({ search: "Acme" });
    expect(listed.total).toBe(1);
    expect(listed.data[0]?.id).toBe(org.id);
    expect(listed.data[0]?.contactCount).toBe(1);
    expect(countOrgLinkedContacts(org.id)).toBe(1);

    const linked = listOrgLinkedContacts(org.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.name).toBe("Jordan Lee");
    expect(linked[0]?.worksAtTitle).toBe("Engineer");
  });

  it("excludes local_only works_at edges by default", () => {
    const org = createOrg({ name: "Scoped Corp", source: "test" });
    const sharedContact = createContact({ name: "Shared Person" });
    const localContact = createContact({ name: "Private Person" });

    dualWriteContactCompany(sharedContact.id, "Scoped Corp", "Public role");
    upsertGraphEdge({
      srcType: "contact",
      srcId: localContact.id,
      dstType: "org",
      dstId: org.id,
      edgeType: "works_at",
      scope: "local_only",
      properties: JSON.stringify({ title: "Hidden role" }),
      source: "test",
    });

    expect(countOrgLinkedContacts(org.id)).toBe(1);
    expect(listOrgLinkedContacts(org.id)).toHaveLength(1);
    expect(listOrgLinkedContacts(org.id)[0]?.name).toBe("Shared Person");

    expect(countOrgLinkedContacts(org.id, { includeLocalOnly: true })).toBe(2);
    expect(listOrgLinkedContacts(org.id, { includeLocalOnly: true })).toHaveLength(2);

    const listed = listOrgsWithContactCounts({ search: "Scoped" });
    expect(listed.data[0]?.contactCount).toBe(1);
    const listedPrivate = listOrgsWithContactCounts({
      search: "Scoped",
      includeLocalOnly: true,
    });
    expect(listedPrivate.data[0]?.contactCount).toBe(2);
  });

  it("GET/POST /api/orgs and GET /api/orgs/[id]/contacts", async () => {
    const createReq = new NextRequest("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "RealtimeX",
        orgType: "company",
        domain: "realtimex.ai",
        website: "www.realtimex.ai",
      }),
    });
    const createRes = await createOrgRoute(createReq);
    expect(createRes.status).toBe(201);
    const org = await createRes.json();
    expect(org.website).toBe("https://www.realtimex.ai/");

    const contact = createContact({ name: "Dev Test", company: "RealtimeX" });
    dualWriteContactCompany(contact.id, "RealtimeX", "Founder");

    const listRes = await listOrgs(new NextRequest("http://localhost/api/orgs?search=Realtime"));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.total).toBe(1);
    expect(listBody.data[0]?.contactCount).toBe(1);

    const getRes = await getOrg(new NextRequest(`http://localhost/api/orgs/${org.id}`), {
      params: Promise.resolve({ id: org.id }),
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.name).toBe("RealtimeX");

    const contactsRes = await listOrgContacts(
      new NextRequest(`http://localhost/api/orgs/${org.id}/contacts`),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(contactsRes.status).toBe(200);
    const contactsBody = await contactsRes.json();
    expect(contactsBody.total).toBe(1);
    expect(contactsBody.data[0]?.name).toBe("Dev Test");
  });

  it("rejects invalid website URLs on POST /api/orgs", async () => {
    const createReq = new NextRequest("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad URL Co",
        website: "not a url",
      }),
    });
    const createRes = await createOrgRoute(createReq);
    expect(createRes.status).toBe(400);
    const body = await createRes.json();
    expect(body.error).toBe("Invalid website URL");
  });

  it("GET /api/orgs/[id]/contacts excludes local_only edges unless opted in", async () => {
    const org = createOrg({ name: "API Scope Co", source: "test" });
    const sharedContact = createContact({ name: "Visible" });
    const localContact = createContact({ name: "Hidden" });
    dualWriteContactCompany(sharedContact.id, "API Scope Co", "CEO");
    upsertGraphEdge({
      srcType: "contact",
      srcId: localContact.id,
      dstType: "org",
      dstId: org.id,
      edgeType: "works_at",
      scope: "local_only",
      properties: JSON.stringify({ title: "Advisor" }),
      source: "test",
    });

    const defaultRes = await listOrgContacts(
      new NextRequest(`http://localhost/api/orgs/${org.id}/contacts`),
      { params: Promise.resolve({ id: org.id }) },
    );
    const defaultBody = await defaultRes.json();
    expect(defaultBody.total).toBe(1);
    expect(defaultBody.data[0]?.name).toBe("Visible");

    const privateRes = await listOrgContacts(
      new NextRequest(
        `http://localhost/api/orgs/${org.id}/contacts?includeLocalOnly=true`,
      ),
      { params: Promise.resolve({ id: org.id }) },
    );
    const privateBody = await privateRes.json();
    expect(privateBody.total).toBe(2);
  });
});
