import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { CONTACT_IMPORT_TOOL_NAMES } from "@/lib/agent-tools/invoke";
import { createOrg } from "@/lib/db/queries/orgs";
import { createOrgIdentity } from "@/lib/db/queries/org-identities";
import { listContacts } from "@/lib/db/queries/contacts";
import { resetCoreTables } from "@/test/db";

const VALID_INPUTS: Record<(typeof CONTACT_IMPORT_TOOL_NAMES)[number], object> = {
  query_contacts: {},
  resolve_platform_claim: { platform: "x", platformUserId: "contract-user" },
  create_contact: { name: "Contract Contact" },
  enrich_contact: { contactId: "contract-contact", title: "Builder" },
  upsert_contact_identity: {
    contactId: "contract-contact",
    platform: "x",
    platformUserId: "contract-user",
  },
  record_workflow_run_contacts: { runId: "contract-run" },
};

async function invoke(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

describe("contact-import agent-tool response contract", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(CONTACT_IMPORT_TOOL_NAMES)(
    "%s cannot surface a legacy error result inside success:true",
    async (tool) => {
      vi.spyOn(AGENT_TOOLS[tool], "execute").mockResolvedValue({
        error: "legacy handler failure",
      });

      const { response, body } = await invoke(tool, VALID_INPUTS[tool]);

      expect(response.status).toBe(500);
      expect(body).toMatchObject({
        success: false,
        code: "EXECUTION_ERROR",
        error: "legacy handler failure",
      });
      expect(body).not.toHaveProperty("result");
    },
  );

  it("returns validation failures as a 400 machine-readable envelope", async () => {
    const { response, body } = await invoke("query_contacts", {
      createdSourceDetail: "create_contact",
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      error: expect.stringContaining("Ambiguous createdSourceDetail"),
    });
  });

  it("returns missing enrichment targets as a 404 machine-readable envelope", async () => {
    const { response, body } = await invoke("enrich_contact", {
      contactId: "missing-contact",
      title: "Builder",
    });

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      success: false,
      code: "NOT_FOUND",
      error: "Contact not found: missing-contact",
    });
  });

  it("round-trips identity provenance through create_contact, upsert_contact_identity and get_contact", async () => {
    const created = await invoke("create_contact", {
      name: "Sas P",
      platform: "linkedin",
      platformUserId: "sasmita-s",
      provenance: { kind: "inferred", observedAt: 1_732_400_000 },
    });
    expect(created.response.status).toBe(200);
    expect(created.body.result).toMatchObject({ isExisting: false, identityProvenanceWrite: "applied" });
    const contactId = created.body.result.id as string;

    const upgraded = await invoke("upsert_contact_identity", {
      contactId,
      platform: "linkedin",
      platformUserId: "sasmita-s",
      provenance: { kind: "self_declared", sourceUrl: "https://lu.ma/user/sas-p" },
    });
    expect(upgraded.response.status).toBe(200);
    expect(upgraded.body.result.provenanceWrite).toBe("applied");

    const read = await invoke("get_contact", { contactId });
    expect(read.body.result.identities).toEqual([
      expect.objectContaining({
        platform: "linkedin",
        platformUserId: "sasmita-s",
        provenance: {
          kind: "self_declared",
          sourceUrl: "https://lu.ma/user/sas-p",
          observedAt: expect.any(Number),
        },
      }),
    ]);
  });

  it("rejects provenance without a kind as a 400 machine-readable envelope", async () => {
    const { response, body } = await invoke("create_contact", {
      name: "No Kind",
      platform: "linkedin",
      platformUserId: "no-kind",
      provenance: { sourceUrl: "https://lu.ma/user/no-kind" },
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(listContacts({ search: "No Kind" }).total).toBe(0);
  });

  it("rejects an org-held create before mutation with actionable conflict details", async () => {
    const org = createOrg({ name: "Claim Owner" });
    const identity = createOrgIdentity({
      orgId: org.id,
      platform: "x",
      platformUserId: "claimed-account",
    });

    const { response, body } = await invoke("create_contact", {
      name: "Rejected Duplicate",
      platform: "x",
      platformUserId: "claimed-account",
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: "CONFLICT",
      details: {
        platform: "x",
        platformUserId: "claimed-account",
        claimant: { kind: "org", orgId: org.id, identityId: identity.id },
      },
    });
    expect(listContacts({ search: "Rejected Duplicate" }).total).toBe(0);
  });
});
