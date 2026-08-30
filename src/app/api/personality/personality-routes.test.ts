import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getRepresentedOrg, PUT as putRepresentedOrg } from "@/app/api/personality/represented-org/route";
import { GET as getSources } from "@/app/api/personality/sources/route";
import { GET as getStatements, PUT as putStatements } from "@/app/api/personality/statements/route";
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
});
