import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";

describe("ARPP and AROO agent tools", () => {
  beforeEach(() => resetCoreTables());

  it("advertises both projection tools", () => {
    const names = listAgentToolsManifest().tools.map((tool) => tool.name);
    expect(names).toContain("get_contact_arpp");
    expect(names).toContain("get_org_aroo");
  });

  it("projects contact and organization records", async () => {
    const org = createOrg({ name: "Acme", domain: "acme.example" });
    const contact = createContact({
      name: "Jordan Lee",
      employments: [{ orgId: org.id, title: "Founder", isCurrent: true }],
    });

    await expect(
      invokeAgentTool("get_contact_arpp", {
        contactId: contact.id,
        visibility: "public",
      }),
    ).resolves.toMatchObject({
      "@type": "Person",
      meta: { visibility: "public" },
      signals: { contactId: contact.id },
    });

    await expect(
      invokeAgentTool("get_org_aroo", { orgId: org.id, visibility: "internal" }),
    ).resolves.toMatchObject({
      "@type": "Organization",
      meta: { visibility: "internal" },
      signals: { orgId: org.id },
    });
  });

  it("reports missing records as NOT_FOUND", async () => {
    await expect(
      invokeAgentTool("get_contact_arpp", { contactId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      invokeAgentTool("get_org_aroo", { orgId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
