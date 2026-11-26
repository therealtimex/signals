import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AgentToolError } from "@/lib/agent-tools/types";
import { createContact, listContacts } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import {
  identityProvenanceRank,
  resolveIdentityProvenanceWrite,
} from "@/lib/identity-provenance";
import { mergeContactAliases } from "@/lib/contact-aliases";
import { resetCoreTables } from "@/test/db";

type Provenance = { kind: string; sourceUrl: string | null; observedAt: number | null } | null;
type Identity = {
  id: string;
  platform: string;
  platformUserId: string;
  isPrimary: boolean;
  provenance: Provenance;
};
type Contact = { id: string; name: string; aliases: string[]; identities: Identity[] };
type UpsertResult = Identity & { provenanceWrite: string; message: string };

const LUMA = "https://lu.ma/user/sas-p";

async function invokeHttp(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

async function upsert(input: object): Promise<UpsertResult> {
  return (await invokeAgentTool("upsert_contact_identity", input)) as UpsertResult;
}

async function getContact(contactId: string): Promise<Contact> {
  return (await invokeAgentTool("get_contact", { contactId })) as Contact;
}

async function identityProvenance(contactId: string, platformUserId: string): Promise<Provenance> {
  const contact = await getContact(contactId);
  return contact.identities.find((row) => row.platformUserId === platformUserId)?.provenance ?? null;
}

function linkedIn(contactId: string, provenance?: object, extra: object = {}) {
  return upsert({
    contactId,
    platform: "linkedin",
    platformUserId: "sasmita-s",
    platformUrl: "https://www.linkedin.com/in/sasmita-s",
    ...(provenance ? { provenance } : {}),
    ...extra,
  });
}

describe("identity provenance rules", () => {
  it("orders kinds strictly: self_declared > agent_verified > inferred > unknown", () => {
    expect(identityProvenanceRank("self_declared")).toBeGreaterThan(
      identityProvenanceRank("agent_verified"),
    );
    expect(identityProvenanceRank("agent_verified")).toBeGreaterThan(
      identityProvenanceRank("inferred"),
    );
    expect(identityProvenanceRank("inferred")).toBeGreaterThan(identityProvenanceRank(null));
  });

  it("applies the same or a stronger kind, keeps a stronger stored kind, and defaults observedAt", () => {
    expect(resolveIdentityProvenanceWrite({ provenanceKind: "inferred" }, undefined)).toEqual({
      outcome: "not_provided",
    });
    expect(
      resolveIdentityProvenanceWrite({ provenanceKind: "self_declared" }, { kind: "agent_verified" }),
    ).toEqual({ outcome: "kept_existing" });
    expect(
      resolveIdentityProvenanceWrite({ provenanceKind: "agent_verified" }, { kind: "agent_verified" }, 1_700),
    ).toEqual({
      outcome: "applied",
      columns: { provenanceKind: "agent_verified", provenanceSourceUrl: null, provenanceObservedAt: 1_700 },
    });
    expect(
      resolveIdentityProvenanceWrite(
        { provenanceKind: null },
        { kind: "inferred", sourceUrl: "https://example.com", observedAt: 42 },
      ),
    ).toEqual({
      outcome: "applied",
      columns: { provenanceKind: "inferred", provenanceSourceUrl: "https://example.com", provenanceObservedAt: 42 },
    });
  });
});

describe("upsert_contact_identity provenance", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("stores provenance on create and returns it from the upsert, get_contact and query_contacts", async () => {
    const contact = createContact({ name: "Sas P" });
    const before = Math.floor(Date.now() / 1000);

    const result = await linkedIn(contact.id, { kind: "self_declared", sourceUrl: LUMA });

    expect(result.provenanceWrite).toBe("applied");
    expect(result.provenance).toMatchObject({ kind: "self_declared", sourceUrl: LUMA });
    expect(result.provenance?.observedAt).toBeGreaterThanOrEqual(before);

    expect(await identityProvenance(contact.id, "sasmita-s")).toEqual(result.provenance);
    const listed = (await invokeAgentTool("query_contacts", {})) as {
      contacts: Array<{ id: string; identities: Array<{ platformUserId: string; provenance: Provenance }> }>;
    };
    expect(
      listed.contacts.find((row) => row.id === contact.id)?.identities[0].provenance,
    ).toEqual(result.provenance);
  });

  it("keeps an explicit observedAt", async () => {
    const contact = createContact({ name: "Sas P" });
    const result = await linkedIn(contact.id, { kind: "inferred", observedAt: 1_732_400_000 });
    expect(result.provenance).toEqual({ kind: "inferred", sourceUrl: null, observedAt: 1_732_400_000 });
  });

  it("leaves provenance null (unknown) when none is given, including identities from before #571", async () => {
    const contact = createContact({ name: "Legacy" });
    const legacy = createIdentity({ contactId: contact.id, platform: "x", platformUserId: "legacy" });

    const result = await upsert({ contactId: contact.id, platform: "x", platformUserId: "fresh" });

    expect(result.provenanceWrite).toBe("not_provided");
    expect(result.provenance).toBeNull();
    expect(legacy.provenanceKind).toBeNull();
    expect(await identityProvenance(contact.id, "legacy")).toBeNull();
  });

  it("never lets a weaker kind overwrite a stronger one, and lets the same or a stronger kind replace it", async () => {
    const contact = createContact({ name: "Sas P" });
    const first = await linkedIn(contact.id, { kind: "self_declared", sourceUrl: LUMA, observedAt: 100 });
    expect(first.provenanceWrite).toBe("applied");

    const verified = await linkedIn(contact.id, {
      kind: "agent_verified",
      sourceUrl: "https://example.com/team",
    });
    expect(verified.provenanceWrite).toBe("kept_existing");
    expect(verified.message).toContain("kept the stored self_declared provenance");
    expect(await identityProvenance(contact.id, "sasmita-s")).toEqual({
      kind: "self_declared",
      sourceUrl: LUMA,
      observedAt: 100,
    });

    const inferred = await linkedIn(contact.id, { kind: "inferred" });
    expect(inferred.provenanceWrite).toBe("kept_existing");

    const omitted = await linkedIn(contact.id, undefined, { headline: "Builder" });
    expect(omitted.provenanceWrite).toBe("not_provided");
    expect(omitted.provenance?.kind).toBe("self_declared");

    const sameKind = await linkedIn(contact.id, {
      kind: "self_declared",
      sourceUrl: "https://sasmita.dev/about",
      observedAt: 200,
    });
    expect(sameKind.provenanceWrite).toBe("applied");
    expect(await identityProvenance(contact.id, "sasmita-s")).toEqual({
      kind: "self_declared",
      sourceUrl: "https://sasmita.dev/about",
      observedAt: 200,
    });
  });

  it("upgrades inferred to agent_verified, and agent_verified to self_declared", async () => {
    const contact = createContact({ name: "Sas P" });
    await linkedIn(contact.id, { kind: "inferred", sourceUrl: "https://www.google.com/search?q=sas" });

    const verified = await linkedIn(contact.id, { kind: "agent_verified" });
    expect(verified.provenanceWrite).toBe("applied");
    expect(verified.provenance).toMatchObject({ kind: "agent_verified", sourceUrl: null });

    const declared = await linkedIn(contact.id, { kind: "self_declared", sourceUrl: LUMA });
    expect(declared.provenanceWrite).toBe("applied");
    expect(declared.provenance?.kind).toBe("self_declared");
  });

  it("applies the rule when updating by identity id", async () => {
    const contact = createContact({ name: "Sas P" });
    const created = await linkedIn(contact.id, { kind: "agent_verified" });

    const weaker = await upsert({
      id: created.id,
      contactId: contact.id,
      provenance: { kind: "inferred" },
    });
    expect(weaker.provenanceWrite).toBe("kept_existing");

    const stronger = await upsert({
      id: created.id,
      contactId: contact.id,
      provenance: { kind: "self_declared", sourceUrl: LUMA },
    });
    expect(stronger.provenanceWrite).toBe("applied");
    expect(await identityProvenance(contact.id, "sasmita-s")).toMatchObject({
      kind: "self_declared",
      sourceUrl: LUMA,
    });
  });

  it("rejects invalid provenance before writing the identity", async () => {
    const contact = createContact({ name: "Sas P" });
    const base = {
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "sasmita-s",
    };
    const invalid: Array<[string, object]> = [
      ["missing kind", { sourceUrl: LUMA }],
      ["unknown kind", { kind: "verified" }],
      ["non-URL sourceUrl", { kind: "self_declared", sourceUrl: "lu.ma profile" }],
      ["non-http sourceUrl", { kind: "self_declared", sourceUrl: "ftp://lu.ma/user/sas-p" }],
      ["overlong sourceUrl", { kind: "self_declared", sourceUrl: `https://lu.ma/${"a".repeat(2_100)}` }],
      ["millisecond observedAt", { kind: "inferred", observedAt: 1_732_400_000_000 }],
      ["fractional observedAt", { kind: "inferred", observedAt: 1.5 }],
    ];
    for (const [label, provenance] of invalid) {
      const { response, body } = await invokeHttp("upsert_contact_identity", { ...base, provenance });
      expect(response.status, label).toBe(400);
      expect(body.code, label).toBe("VALIDATION_ERROR");
    }

    await expect(
      linkedIn(contact.id, {
        kind: "self_declared",
        sourceUrl: "https://www.linkedin.com/authwall?trk=bf",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { field: "provenance.sourceUrl" } });

    expect((await getContact(contact.id)).identities).toEqual([]);
  });
});

describe("create_contact provenance (import path)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("applies provenance to the identity a new contact is created with", async () => {
    const created = (await invokeAgentTool("create_contact", {
      name: "Sas P",
      platform: "linkedin",
      platformUserId: "sasmita-s",
      platformUrl: "https://www.linkedin.com/in/sasmita-s",
      provenance: { kind: "self_declared", sourceUrl: LUMA },
    })) as { id: string; isExisting: boolean; identityProvenanceWrite?: string };

    expect(created.isExisting).toBe(false);
    expect(created.identityProvenanceWrite).toBe("applied");
    expect(await identityProvenance(created.id, "sasmita-s")).toMatchObject({
      kind: "self_declared",
      sourceUrl: LUMA,
    });
  });

  it("applies the downgrade rule when create_contact matches an existing contact", async () => {
    const first = (await invokeAgentTool("create_contact", {
      name: "Sas P",
      platform: "linkedin",
      platformUserId: "sasmita-s",
      provenance: { kind: "self_declared", sourceUrl: LUMA },
    })) as { id: string };

    const second = (await invokeAgentTool("create_contact", {
      name: "Sasmita S",
      platform: "linkedin",
      platformUserId: "sasmita-s",
      provenance: { kind: "inferred" },
    })) as { id: string; isExisting: boolean; identityProvenanceWrite?: string };

    expect(second).toMatchObject({ id: first.id, isExisting: true, identityProvenanceWrite: "kept_existing" });
    expect((await identityProvenance(first.id, "sasmita-s"))?.kind).toBe("self_declared");
  });

  it("rejects a login/auth-wall sourceUrl before creating anything, so a corrected retry creates one contact", async () => {
    const row = {
      name: "Wall Row",
      platform: "linkedin",
      platformUserId: "wall-row",
    };

    for (const sourceUrl of [
      "https://www.linkedin.com/authwall?trk=x",
      "https://www.linkedin.com/login",
    ]) {
      await expect(
        invokeAgentTool("create_contact", {
          ...row,
          provenance: { kind: "self_declared", sourceUrl },
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { field: "provenance.sourceUrl", url: sourceUrl },
      });
    }
    expect(listContacts({ search: "Wall Row" }).total).toBe(0);

    const retried = (await invokeAgentTool("create_contact", {
      ...row,
      provenance: { kind: "self_declared", sourceUrl: "https://lu.ma/user/wall" },
    })) as { id: string; isExisting: boolean };
    expect(retried.isExisting).toBe(false);
    expect(listContacts({ search: "Wall Row" }).total).toBe(1);
    expect(await identityProvenance(retried.id, "wall-row")).toMatchObject({
      kind: "self_declared",
      sourceUrl: "https://lu.ma/user/wall",
    });
  });

  it("rejects an auth-wall sourceUrl on a matched contact without enriching it", async () => {
    const first = (await invokeAgentTool("create_contact", {
      name: "Sas P",
      platform: "linkedin",
      platformUserId: "sasmita-s",
    })) as { id: string };

    await expect(
      invokeAgentTool("create_contact", {
        name: "Sas P",
        title: "Should not be written",
        platform: "linkedin",
        platformUserId: "sasmita-s",
        provenance: { kind: "self_declared", sourceUrl: "https://www.linkedin.com/authwall" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const after = (await invokeAgentTool("get_contact", { contactId: first.id })) as Contact & {
      title: string | null;
    };
    expect(after.title).toBeNull();
    expect(after.identities[0].provenance).toBeNull();
  });

  it("ignores provenance and reports nothing when no platform identity is given", async () => {
    const created = (await invokeAgentTool("create_contact", {
      name: "No Identity",
      provenance: { kind: "self_declared" },
    })) as { id: string; identityProvenanceWrite?: string };

    expect(created.identityProvenanceWrite).toBeUndefined();
    expect((await getContact(created.id)).identities).toEqual([]);
  });
});

describe("contact aliases", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("merges case-insensitively, keeps the first spelling and skips the contact's own name", () => {
    expect(
      mergeContactAliases(["Sas P"], ["  Sasmita   S ", "sas p", "SASMITA S", "Sasmita Sharma"], "Sasmita Sharma"),
    ).toEqual({ aliases: ["Sas P", "Sasmita S"], added: ["Sasmita S"] });
  });

  it("appends aliases through enrich_contact and returns them from get_contact", async () => {
    const contact = createContact({ name: "Sas P" });
    expect((await getContact(contact.id)).aliases).toEqual([]);

    const first = (await invokeAgentTool("enrich_contact", {
      contactId: contact.id,
      aliases: ["Sasmita S", "sasmita s", "Sas P"],
    })) as { fieldsUpdated: string[] };
    expect(first.fieldsUpdated).toContain("aliases");
    expect((await getContact(contact.id)).aliases).toEqual(["Sasmita S"]);

    const second = (await invokeAgentTool("enrich_contact", {
      contactId: contact.id,
      aliases: ["SASMITA S", "Sasmita Sharma"],
    })) as { fieldsUpdated: string[] };
    expect(second.fieldsUpdated).toContain("aliases");
    expect((await getContact(contact.id)).aliases).toEqual(["Sasmita S", "Sasmita Sharma"]);

    const noop = (await invokeAgentTool("enrich_contact", {
      contactId: contact.id,
      aliases: ["sasmita sharma"],
    })) as { fieldsUpdated: string[] };
    expect(noop.fieldsUpdated).not.toContain("aliases");
  });

  it("validates alias input and the per-contact cap without partial writes", async () => {
    const contact = createContact({ name: "Sas P" });
    for (const aliases of [[], [""], ["x".repeat(121)], Array.from({ length: 21 }, (_, i) => `A${i}`)]) {
      const { response } = await invokeHttp("enrich_contact", { contactId: contact.id, aliases });
      expect(response.status).toBe(400);
    }

    for (let batch = 0; batch < 2; batch += 1) {
      await invokeAgentTool("enrich_contact", {
        contactId: contact.id,
        aliases: Array.from({ length: 20 }, (_, i) => `Alias ${batch}-${i}`),
      });
    }
    let thrown: unknown;
    try {
      await invokeAgentTool("enrich_contact", {
        contactId: contact.id,
        title: "Should not be written",
        aliases: Array.from({ length: 11 }, (_, i) => `Overflow ${i}`),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AgentToolError);
    expect(thrown).toMatchObject({ code: "VALIDATION_ERROR" });
    const after = (await invokeAgentTool("get_contact", { contactId: contact.id })) as Contact & {
      title: string | null;
    };
    expect(after.aliases).toHaveLength(40);
    expect(after.title).toBeNull();
  });

  it("applies the 120-character alias cap after normalization", async () => {
    const contact = createContact({ name: "Sas P" });
    // 7 characters pass the schema, but NFKC expands U+FDFA to 18 characters each: 126 in all.
    const expanding = "\uFDFA".repeat(7);
    let thrown: unknown;
    try {
      await invokeAgentTool("enrich_contact", { contactId: contact.id, title: "Not written", aliases: ["Sasmita S", expanding] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "VALIDATION_ERROR" });
    const after = (await invokeAgentTool("get_contact", { contactId: contact.id })) as Contact & { title: string | null };
    expect(after.aliases).toEqual([]);
    expect(after.title).toBeNull();

    await invokeAgentTool("enrich_contact", { contactId: contact.id, aliases: ["\uFDFA".repeat(6)] });
    const ok = (await invokeAgentTool("get_contact", { contactId: contact.id })) as Contact;
    expect(ok.aliases[0]).toHaveLength(108);
  });
});
