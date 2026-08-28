import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getContactArpp } from "@/app/api/contacts/[id]/arpp/route";
import { GET as getOrgAroo } from "@/app/api/orgs/[id]/aroo/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";

describe("ARPP and AROO routes", () => {
  beforeEach(() => resetCoreTables());

  it("returns a contact ARPP document as linked data", async () => {
    const org = createOrg({
      name: "Acme",
      domain: "acme.example",
      website: "https://acme.example",
      description: "Makes useful things",
      industry: "Software",
    });
    const contact = createContact({
      name: "Jordan Lee",
      headline: "Founder at Acme",
      bio: "Builds useful things.",
      platform: "x",
      platformUserId: "jordan",
      employments: [{ orgId: org.id, title: "Founder", isCurrent: true }],
    });

    const response = await getContactArpp(
      new NextRequest(`http://localhost/api/contacts/${contact.id}/arpp?pretty=1`),
      { params: Promise.resolve({ id: contact.id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/ld+json; charset=utf-8");
    expect(await response.text()).toContain("\n  \"$schema\"");

    const publicResponse = await getContactArpp(
      new NextRequest(
        `http://localhost/api/contacts/${contact.id}/arpp?visibility=public`,
      ),
      { params: Promise.resolve({ id: contact.id }) },
    );
    await expect(publicResponse.json()).resolves.toMatchObject({
      "@type": "Person",
      meta: { visibility: "public" },
      signals: { contactId: contact.id, conformance: expect.stringMatching(/^L[0-3]$/) },
      experience: [
        expect.objectContaining({
          role: "Founder",
          organization: expect.objectContaining({ name: "Acme" }),
        }),
      ],
    });
  });

  it("returns an organization AROO document and validates visibility", async () => {
    const org = createOrg({
      name: "Acme",
      domain: "acme.example",
      description: "Makes useful things",
      industry: "Software",
      accountStage: "customer",
    });

    const response = await getOrgAroo(
      new NextRequest(`http://localhost/api/orgs/${org.id}/aroo?visibility=public`),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/ld+json; charset=utf-8");
    await expect(response.json()).resolves.toMatchObject({
      "@type": "Organization",
      meta: { visibility: "public" },
      identity: { name: "Acme" },
      signals: { orgId: org.id, conformance: expect.stringMatching(/^O[0-3]$/) },
    });

    const invalid = await getOrgAroo(
      new NextRequest(`http://localhost/api/orgs/${org.id}/aroo?visibility=private`),
      { params: Promise.resolve({ id: org.id }) },
    );
    expect(invalid.status).toBe(400);
  });

  it("returns not found for missing records", async () => {
    const contact = await getContactArpp(
      new NextRequest("http://localhost/api/contacts/missing/arpp"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const org = await getOrgAroo(
      new NextRequest("http://localhost/api/orgs/missing/aroo"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(contact.status).toBe(404);
    expect(org.status).toBe(404);
  });
});
