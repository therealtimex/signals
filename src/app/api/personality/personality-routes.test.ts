import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getRepresentedOrg, PUT as putRepresentedOrg } from "@/app/api/personality/represented-org/route";
import { GET as getSources } from "@/app/api/personality/sources/route";
import { GET as getStatements, PUT as putStatements } from "@/app/api/personality/statements/route";
import { GET as getBinding } from "@/app/api/personality/binding/route";
import { GET as getHost } from "@/app/api/personality/host/route";
import { POST as postProposal } from "@/app/api/personality/proposals/route";
import { GET as getProposal } from "@/app/api/personality/proposals/[id]/route";
import { POST as approveProposal } from "@/app/api/personality/proposals/[id]/approve/route";
import { POST as retryProposal } from "@/app/api/personality/proposals/[id]/retry/route";
import { POST as rejectProposal } from "@/app/api/personality/proposals/[id]/reject/route";
import { POST as rollbackProposal } from "@/app/api/personality/rollback/route";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";
import { db } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { orgs } from "@/lib/db/schema";
import { getRepresentedOrgId, setRepresentedOrgId } from "@/lib/settings/signals-config";
import { resetCoreTables } from "@/test/db";

function jsonRequest(url: string, value: unknown): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function jsonPost(url: string, value: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("Personality M1 routes and tool", () => {
  beforeEach(() => {
    resetCoreTables();
    setRepresentedOrgId(null);
  });

  it("uses the same statements handler for REST and the agent tool", async () => {
    await expect(getStatements().then((response) => response.json())).resolves.toMatchObject({
      schemaVersion: 1,
      values: [],
      boundaries: [],
      updatedAt: 0,
    });
    const rest = await putStatements(jsonRequest(
      "http://localhost/api/personality/statements",
      { values: ["Build"], boundaries: ["No hype"] },
    ));
    expect(rest.status).toBe(200);
    await expect(rest.json()).resolves.toMatchObject({ values: ["Build"], boundaries: ["No hype"] });

    await expect(invokeAgentTool("upsert_personality_statements", {
      values: ["Serve users"],
      boundaries: ["No invented facts"],
    })).resolves.toMatchObject({
      values: ["Serve users"],
      boundaries: ["No invented facts"],
    });
    const definition = listAgentToolsManifest().tools.find(
      (tool) => tool.name === "upsert_personality_statements",
    );
    expect(definition).toMatchObject({ category: "content" });
    expect(definition?.parameters).toMatchObject({
      type: "object",
      required: ["values", "boundaries"],
    });
  });

  it("validates represented org ownership before changing config", async () => {
    const self = createContact({ name: "Self", isSelf: true });
    const own = createOrg({ name: "Owned", ownerContactId: self.id });
    const foreignContact = createContact({ name: "Foreign" });
    const foreign = createOrg({ name: "Foreign org" });
    db.update(orgs)
      .set({ ownerContactId: foreignContact.id })
      .where(eq(orgs.id, foreign.id))
      .run();

    const accepted = await putRepresentedOrg(jsonRequest(
      "http://localhost/api/personality/represented-org",
      { orgId: own.id },
    ));
    expect(accepted.status).toBe(200);
    expect(getRepresentedOrgId()).toBe(own.id);
    await expect(getRepresentedOrg().then((response) => response.json())).resolves.toMatchObject({
      selected: { id: own.id },
      candidates: [expect.objectContaining({ id: own.id })],
    });

    const rejected = await putRepresentedOrg(jsonRequest(
      "http://localhost/api/personality/represented-org",
      { orgId: foreign.id },
    ));
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ reason: "org_not_represented" });
    expect(getRepresentedOrgId()).toBe(own.id);
  });

  it("returns a deterministic workspace-free source preview and a typed missing-self error", async () => {
    const missing = await getSources();
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ reason: "self_contact_missing" });

    createContact({ name: "Self", isSelf: true });
    const first = await getSources();
    const second = await getSources();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstText = await first.text();
    expect(await second.text()).toBe(firstText);
    const preview = JSON.parse(firstText);
    expect(preview).toMatchObject({
      self: { name: "Self" },
      org: null,
      voice: { status: "none", candidates: [] },
      blocks: {
        identity: { body: expect.stringContaining("Represents: self") },
        brand: null,
        voice: null,
        boundaries: { body: expect.stringContaining("explicit human instruction") },
      },
    });
    expect(JSON.stringify(preview)).not.toMatch(/bindingId|workspaceDir|workspaceSlug/);
  });

  it("publishes the bounded Personality proposal and recovery tool contracts", () => {
    const tools = new Map(listAgentToolsManifest().tools.map((tool) => [tool.name, tool]));
    expect([
      "get_personality_binding",
      "propose_personality_projection",
      "approve_personality_projection",
      "reject_personality_projection",
      "retry_personality_projection",
      "rollback_personality_projection",
      "unbind_personality_projection",
    ].every((name) => tools.get(name)?.category === "content")).toBe(true);
    expect(tools.get("propose_personality_projection")?.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { voiceProfileId: expect.any(Object) },
    });
    expect(tools.get("approve_personality_projection")?.parameters).toMatchObject({
      required: ["proposalId", "evidence"],
      properties: {
        evidence: {
          required: ["kind", "workspaceSlug", "threadSlug"],
          properties: { kind: { const: "thread_message" } },
        },
      },
    });
    expect(tools.get("unbind_personality_projection")?.parameters).toMatchObject({
      additionalProperties: false,
      properties: {},
    });
  });

  it("keeps the REST proposal surface in parity with validation and error mappings", async () => {
    const missingParams = { params: Promise.resolve({ id: "prp_missing01" }) };
    const binding = await getBinding();
    expect(binding.status).toBe(200);
    await expect(binding.json()).resolves.toMatchObject({
      status: { status: "unavailable", host: { capability: "unreachable" } },
    });
    await expect(getHost().then((response) => response.json())).resolves.toMatchObject({
      state: "unreachable",
    });
    expect((await postProposal(jsonPost(
      "http://localhost/api/personality/proposals",
      { arbitraryWorkspaceSlug: "other" },
    ))).status).toBe(400);
    expect((await getProposal(new Request(
      "http://localhost/api/personality/proposals/prp_missing01",
    ), missingParams)).status).toBe(404);
    expect((await approveProposal(new Request(
      "http://localhost/api/personality/proposals/prp_missing01/approve",
      { method: "POST" },
    ), missingParams)).status).toBe(404);
    expect((await retryProposal(new Request(
      "http://localhost/api/personality/proposals/prp_missing01/retry",
      { method: "POST" },
    ), missingParams)).status).toBe(404);
    expect((await rejectProposal(jsonPost(
      "http://localhost/api/personality/proposals/prp_missing01/reject",
      { note: 42 },
    ), missingParams)).status).toBe(400);
    expect((await rollbackProposal(jsonPost(
      "http://localhost/api/personality/rollback",
      { bindingId: "not-a-binding" },
    ))).status).toBe(400);
  });
});
