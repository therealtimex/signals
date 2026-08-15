import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";
import { AgentToolError } from "@/lib/agent-tools/types";
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
    expect(names).toContain("query_org_identities");
    expect(names).toContain("upsert_org_identity");

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
});
