import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createContact } from "@/lib/db/queries/contacts";
import { dualWriteContactCompany } from "@/lib/db/contact-org-dual-write";
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

  it("GET/POST /api/orgs and GET /api/orgs/[id]/contacts", async () => {
    const createReq = new NextRequest("http://localhost/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "RealtimeX",
        orgType: "company",
        domain: "realtimex.ai",
      }),
    });
    const createRes = await createOrgRoute(createReq);
    expect(createRes.status).toBe(201);
    const org = await createRes.json();

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
});
