import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { archiveContact, createContact, getContactById } from "@/lib/db/queries/contacts";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";
import { AgentToolError } from "@/lib/agent-tools/types";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrg } from "@/lib/db/queries/orgs";
import { createOrgIdentity } from "@/lib/db/queries/org-identities";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { listContactEmployments } from "@/lib/db/queries/contact-employments";
import { resetCoreTables } from "@/test/db";

describe("agent-tools registry", () => {
  it("lists CRM tools with JSON schema parameters", () => {
    const manifest = listAgentToolsManifest();
    expect(manifest.version).toBe("1");
    expect(manifest.tools.length).toBeGreaterThanOrEqual(10);

    const names = manifest.tools.map((tool) => tool.name);
    expect(names).toContain("query_contacts");
    expect(names).toContain("create_contact");
    expect(names).toContain("enrich_contact");
    expect(names).toContain("upsert_contact_identity");
    expect(names).toContain("query_org_identities");
    expect(names).toContain("get_org");
    expect(names).toContain("create_org");
    expect(names).toContain("update_org");
    expect(names).toEqual(expect.arrayContaining([
      "get_org_relationships",
      "list_org_contacts",
      "link_contact_to_org",
      "unlink_contact_from_org",
      "get_org_email_intelligence",
      "infer_org_email_pattern",
      "set_org_email_pattern",
      "generate_org_email_candidates",
      "list_email_candidates",
      "update_email_candidate",
      "add_org_domain_alias",
      "log_org_activity",
      "list_org_activity",
      "follow_org",
    ]));
    expect(names).toContain("upsert_org_identity");
    expect(names).toContain("list_mail_accounts");

    const createContact = manifest.tools.find((tool) => tool.name === "create_contact");
    expect(createContact?.parameters).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        name: { type: "string" },
      }),
    });
  });

  it("advertises completed-path requirements for complete_simulation_run", () => {
    const manifest = listAgentToolsManifest();
    const completeRun = manifest.tools.find((tool) => tool.name === "complete_simulation_run");
    expect(completeRun?.description).toContain("predictedMetrics");
    expect(completeRun?.parameters).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        predictedMetrics: expect.objectContaining({ type: "object" }),
      }),
      allOf: expect.arrayContaining([
        expect.objectContaining({
          then: {
            required: ["predictedScore", "predictionConfidence", "predictedMetrics"],
          },
        }),
      ]),
    });
  });
});

describe("invokeAgentTool", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a contact with structured employments when legacy company/title omitted", async () => {
    const org = createOrg({ name: "Structured Corp", source: "test" });

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      employments: [{ orgId: org.id, title: "CEO", isCurrent: true }],
    });

    const contactId = (created as { id: string }).id;
    const contact = getContactById(contactId);

    expect(listContactEmployments(contactId)).toHaveLength(1);
    expect(contact?.currentEmployment).toMatchObject({
      orgId: org.id,
      orgName: "Structured Corp",
      title: "CEO",
    });
    expect(created).toMatchObject({
      currentEmployment: {
        orgId: org.id,
        orgName: "Structured Corp",
        title: "CEO",
      },
    });
  });

  it("creates and enriches a contact", async () => {
    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme",
    });

    expect(created).toMatchObject({
      name: "Jane Doe",
      company: "Acme",
    });

    const contactId = (created as { id: string }).id;

    const enriched = await invokeAgentTool("enrich_contact", {
      contactId,
      title: "VP Sales",
      email: "jane@acme.com",
    });

    expect(enriched).toMatchObject({
      contactId,
      contactName: "Jane Doe",
      fieldsUpdated: expect.arrayContaining(["title", "email"]),
    });
  });

  it("rejects unknown tools", async () => {
    await expect(invokeAgentTool("not_a_tool", {})).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    } satisfies Partial<AgentToolError>);
  });

  it("rejects invalid input", async () => {
    await expect(invokeAgentTool("create_contact", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<AgentToolError>);
  });

  it("sorts query_contacts by enrichment score ascending", async () => {
    const low = createContact({ name: "Low", platform: "x", platformUserId: "low" });
    const high = createContact({ name: "High", platform: "x", platformUserId: "high" });

    db.update(contacts).set({ enrichmentScore: 5 }).where(eq(contacts.id, low.id)).run();
    db.update(contacts).set({ enrichmentScore: 95 }).where(eq(contacts.id, high.id)).run();

    const result = await invokeAgentTool("query_contacts", {
      pageSize: 10,
      sort: "enrichmentScore",
      order: "asc",
    });

    const rows = (result as { contacts: Array<{ id: string; score: number }> }).contacts;
    expect(rows[0]?.id).toBe(low.id);
    expect(rows[0]?.score).toBe(5);
    expect(rows[1]?.id).toBe(high.id);
  });

  it("resolves an existing contact by platform identity claim", async () => {
    const target = createContact({ name: "Sam Altman" });
    createIdentity({ contactId: target.id, platform: "x", platformUserId: "sama" });
    const decoy = createContact({ name: "Sam Decoy" });
    createIdentity({ contactId: decoy.id, platform: "x", platformUserId: "sama-decoy" });

    const result = await invokeAgentTool("query_contacts", {
      platform: "x",
      platformUserId: "sama",
      pageSize: 50,
    });

    const rows = (
      result as {
        contacts: Array<{
          id: string;
          identities: Array<{ platform: string; platformUserId: string }>;
        }>;
      }
    ).contacts;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(target.id);
    expect(rows[0]?.identities).toContainEqual(
      expect.objectContaining({ platform: "x", platformUserId: "sama" }),
    );
  });

  it("resolve_platform_claim reports an unclaimed platform account", async () => {
    const result = await invokeAgentTool("resolve_platform_claim", {
      platform: "x",
      platformUserId: "nobody",
    });

    expect(result).toEqual({ claimed: false });
  });

  it("resolve_platform_claim reports an active contact claimant", async () => {
    const owner = createContact({ name: "Sam Altman" });
    const identity = createIdentity({
      contactId: owner.id,
      platform: "x",
      platformUserId: "sama",
    });

    const result = await invokeAgentTool("resolve_platform_claim", {
      platform: "x",
      platformUserId: "sama",
    });

    expect(result).toEqual({
      claimed: true,
      claimant: {
        kind: "contact",
        contactId: owner.id,
        identityId: identity.id,
        archived: false,
      },
    });
  });

  it("resolve_platform_claim still reports an archived contact claimant", async () => {
    // The write guard does not filter archived contacts, so neither may the
    // resolver — that asymmetry was the #202 archived-owner bug.
    const owner = createContact({ name: "Archived Owner" });
    createIdentity({ contactId: owner.id, platform: "x", platformUserId: "archived-sama" });
    archiveContact(owner.id, "test");

    const result = (await invokeAgentTool("resolve_platform_claim", {
      platform: "x",
      platformUserId: "archived-sama",
    })) as { claimed: boolean; claimant: { contactId: string; archived: boolean } };

    expect(result.claimed).toBe(true);
    expect(result.claimant.contactId).toBe(owner.id);
    expect(result.claimant.archived).toBe(true);
  });

  it("resolve_platform_claim reports an org claimant", async () => {
    // query_contacts could never have seen this: org claims live in a different
    // table entirely, but assertPlatformAccountUnclaimed rejects them just as hard.
    const org = createOrg({ name: "OpenAI" });
    const orgIdentity = createOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "openai",
    });

    const result = await invokeAgentTool("resolve_platform_claim", {
      platform: "x",
      platformUserId: "openai",
    });

    expect(result).toEqual({
      claimed: true,
      claimant: { kind: "org", orgId: org.id, identityId: orgIdentity.id },
    });
  });

  it("upsert_contact_identity agrees with resolve_platform_claim on an org-held account", async () => {
    const org = createOrg({ name: "OpenAI" });
    createOrgIdentity({ orgId: org.id, platform: "x", platformUserId: "openai" });
    const contact = createContact({ name: "Someone" });

    const resolved = (await invokeAgentTool("resolve_platform_claim", {
      platform: "x",
      platformUserId: "openai",
    })) as { claimed: boolean; claimant: { kind: string } };
    expect(resolved.claimant.kind).toBe("org");

    // Must REJECT, not resolve with {error}. The Go client only inspects the outer
    // envelope, so an {error} inside success:true is invisible to it and the import
    // would count a rejected attach as enriched.
    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId: contact.id,
        platform: "x",
        platformUserId: "openai",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<AgentToolError>);
  });

  it("rejects an org-held account even when the contact was matched by email", async () => {
    // The import's email path short-circuits before resolve_platform_claim, so the
    // CLI-side org skip never fires for this row. The server rejection is the only
    // thing standing between it and a silent false success.
    const org = createOrg({ name: "OpenAI" });
    createOrgIdentity({ orgId: org.id, platform: "x", platformUserId: "openai" });
    const contact = createContact({ name: "Email Matched" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "person@example.com",
      isPrimary: true,
      source: "test",
    });

    const byEmail = (await invokeAgentTool("query_contacts", {
      email: "person@example.com",
    })) as { contacts: Array<{ id: string }> };
    expect(byEmail.contacts[0]?.id).toBe(contact.id);

    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId: contact.id,
        platform: "x",
        platformUserId: "openai",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<AgentToolError>);
  });

  it("query_contacts matches an exact normalized non-primary email", async () => {
    // The flat `email` field carries one address, so a non-primary channel used to
    // be a silent dedupe miss (#207).
    const contact = createContact({ name: "Email Owner" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "primary@example.com",
      isPrimary: true,
      source: "test",
    });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "secondary@example.com",
      source: "test",
    });
    const decoy = createContact({ name: "Decoy" });
    createContactChannel({
      contactId: decoy.id,
      channelType: "email",
      value: "decoy@example.com",
      isPrimary: true,
      source: "test",
    });

    const result = (await invokeAgentTool("query_contacts", {
      email: "  SECONDARY@Example.COM  ",
    })) as { contacts: Array<{ id: string }> };

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.id).toBe(contact.id);
  });

  it("query_contacts email filter excludes archived contacts", async () => {
    const contact = createContact({ name: "Archived Email" });
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "gone@example.com",
      isPrimary: true,
      source: "test",
    });
    archiveContact(contact.id, "test");

    const result = (await invokeAgentTool("query_contacts", {
      email: "gone@example.com",
    })) as { contacts: unknown[] };

    expect(result.contacts).toHaveLength(0);
  });

  it("filters query_contacts by createdSourceDetail suffix x_archive", async () => {
    const archive = createContact({ name: "Archive Import" }, "import:x_archive");
    createContact({ name: "Manual Later" }, "manual:create_contact");

    const result = await invokeAgentTool("query_contacts", {
      createdSourceDetail: "x_archive",
    });

    const rows = (result as { contacts: Array<{ id: string }>; total: number }).contacts;
    expect((result as { total: number }).total).toBe(1);
    expect(rows[0]?.id).toBe(archive.id);
  });

  it("returns an error for ambiguous createdSourceDetail suffix", async () => {
    await expect(
      invokeAgentTool("query_contacts", {
        createdSourceDetail: "create_contact",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Ambiguous createdSourceDetail"),
    } satisfies Partial<AgentToolError>);
  });

  it("rejects update_contact payloads that name birth fields", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Birth Guard" });
    const contactId = (created as { id: string }).id;

    await expect(
      invokeAgentTool("update_contact", {
        contactId,
        createdSource: "manual",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<AgentToolError>);
  });

  it("upserts a contact identity and returns it from get_contact", async () => {
    const created = await invokeAgentTool("create_contact", {
      name: "Identity Contact",
    });
    const contactId = (created as { id: string }).id;

    const identity = await invokeAgentTool("upsert_contact_identity", {
      contactId,
      platform: "linkedin",
      platformUserId: "identity-contact-li",
      platformHandle: "identitycontact",
      headline: "Builder",
      avatarUrl: "https://example.com/avatar.jpg",
    });

    expect(identity).toMatchObject({
      platform: "linkedin",
      platformUserId: "identity-contact-li",
      handle: "identitycontact",
      headline: "Builder",
      avatarUrl: "https://example.com/avatar.jpg",
      message: "Contact identity upserted.",
    });

    const contact = await invokeAgentTool("get_contact", { contactId });
    expect(contact).toMatchObject({
      resolvedAvatarUrl: "https://example.com/avatar.jpg",
      identities: [
        expect.objectContaining({
          platform: "linkedin",
          platformUserId: "identity-contact-li",
          headline: "Builder",
          avatarUrl: "https://example.com/avatar.jpg",
        }),
      ],
    });
  });

  it("rejects login and auth-wall URLs as identity evidence", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Authwall Guard" });
    const contactId = (created as { id: string }).id;

    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId,
        platform: "linkedin",
        platformUserId: "authwall-guard",
        platformUrl: "https://www.linkedin.com/authwall?trk=foo",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("login/auth-wall URL"),
    } satisfies Partial<AgentToolError>);

    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId,
        platform: "linkedin",
        platformUserId: "login-guard",
        websiteUrl: "https://www.linkedin.com/login",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" } satisfies Partial<AgentToolError>);

    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId,
        platform: "linkedin",
        platformUserId: "real-profile",
        platformUrl: "https://www.linkedin.com/in/real-profile",
      }),
    ).resolves.toMatchObject({ platformUserId: "real-profile" });
  });

  it("re-upserts the same platform identity idempotently", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Dup Identity" });
    const contactId = (created as { id: string }).id;

    await invokeAgentTool("upsert_contact_identity", {
      contactId,
      platform: "linkedin",
      platformUserId: "dup-id",
      platformHandle: "dup-handle",
    });

    const second = await invokeAgentTool("upsert_contact_identity", {
      contactId,
      platform: "linkedin",
      platformUserId: "dup-id",
      platformHandle: "dup-handle",
    });

    expect(second).toMatchObject({
      platform: "linkedin",
      platformUserId: "dup-id",
      message: "Contact identity upserted.",
    });
  });

  it("rejects local file avatarUrl on upsert_contact_identity", async () => {
    const created = await invokeAgentTool("create_contact", { name: "Avatar Guard" });
    const contactId = (created as { id: string }).id;

    await expect(
      invokeAgentTool("upsert_contact_identity", {
        contactId,
        platform: "linkedin",
        platformUserId: "avatar-guard",
        avatarUrl: "file:///tmp/avatar.jpg",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("upload-avatar"),
    } satisfies Partial<AgentToolError>);
  });

  it("creates a contact with direct platform, handle, and avatarUrl in a single call", async () => {
    const created = await invokeAgentTool("create_contact", {
      name: "David Founder",
      company: "AuraBid",
      title: "Creator",
      platform: "x",
      platformHandle: "chhddavid",
      platformUserId: "chhddavid",
      avatarUrl: "https://example.com/chhddavid.jpg",
    });

    expect(created).toMatchObject({
      name: "David Founder",
      company: "AuraBid",
      isExisting: false,
    });

    const contactId = (created as { id: string }).id;
    const contact = await invokeAgentTool("get_contact", { contactId });
    expect(contact).toMatchObject({
      resolvedAvatarUrl: "https://example.com/chhddavid.jpg",
      identities: [
        expect.objectContaining({
          platform: "x",
          handle: "chhddavid",
          avatarUrl: "https://example.com/chhddavid.jpg",
        }),
      ],
    });
  });

  it("auto-deduplicates when create_contact is called with matching platform claim and enriches existing", async () => {
    const first = await invokeAgentTool("create_contact", {
      name: "Miguel Caçador Peixoto",
      company: "bidwall.app",
      platform: "x",
      platformHandle: "mcpeixoto457",
      platformUserId: "mcpeixoto457",
      avatarUrl: "https://example.com/avatar.jpg",
    });

    const firstId = (first as { id: string }).id;

    // Second call with same platform handle but added title and notes
    const second = await invokeAgentTool("create_contact", {
      name: "Miguel Caçador Peixoto",
      title: "Founder",
      platform: "x",
      platformHandle: "mcpeixoto457",
      notes: "Met at demo day",
    });

    expect(second).toMatchObject({
      id: firstId,
      name: "Miguel Caçador Peixoto",
      company: "bidwall.app",
      isExisting: true,
      message: expect.stringContaining("already exists"),
    });

    // Check that existing contact was enriched with title
    const contact = await invokeAgentTool("get_contact", { contactId: firstId });
    expect(contact).toMatchObject({
      title: "Founder",
      company: "bidwall.app",
      identities: [
        expect.objectContaining({
          platform: "x",
          handle: "mcpeixoto457",
        }),
      ],
    });
  });

  it("auto-deduplicates when create_contact is called with matching email", async () => {
    const first = await invokeAgentTool("create_contact", {
      name: "Alex Builder",
      email: "alex@example.com",
      company: "Original Co",
    });

    const firstId = (first as { id: string }).id;

    const second = await invokeAgentTool("create_contact", {
      name: "Alex Builder",
      email: "alex@example.com",
      title: "CTO",
    });

    expect(second).toMatchObject({
      id: firstId,
      isExisting: true,
    });
  });

  it("auto-deduplicates when create_contact is called with exact matching name and company", async () => {
    const first = await invokeAgentTool("create_contact", {
      name: "Sarah Connors",
      company: "Cyberdyne Systems",
    });

    const firstId = (first as { id: string }).id;

    const second = await invokeAgentTool("create_contact", {
      name: "Sarah Connors",
      company: "Cyberdyne Systems",
      title: "AI Safety Lead",
    });

    expect(second).toMatchObject({
      id: firstId,
      isExisting: true,
    });

    const contact = await invokeAgentTool("get_contact", { contactId: firstId });
    expect(contact).toMatchObject({
      title: "AI Safety Lead",
    });
  });
});
