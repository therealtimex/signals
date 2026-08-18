import { describe, expect, it } from "vitest";
import { smokeFetch, smokeJson } from "./http-client";

describe("smoke: agent tools API", () => {
  it("manifest lists tools", async () => {
    const response = await smokeFetch("/api/agent-tools");
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.version).toBe("1");
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "create_contact",
          description: expect.any(String),
          parameters: expect.objectContaining({ type: "object" }),
        }),
      ])
    );
  });

  it("invoke creates and enriches a contact", async () => {
    const create = await smokeFetch("/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "create_contact",
        input: {
          name: "Agent Tool Smoke",
          company: "Signals QA",
        },
      }),
    });
    expect(create.ok).toBe(true);

    const created = await create.json();
    expect(created).toMatchObject({
      success: true,
      tool: "create_contact",
      result: {
        name: "Agent Tool Smoke",
        company: "Signals QA",
      },
    });

    const contactId = created.result.id as string;

    const enrich = await smokeFetch("/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "enrich_contact",
        input: {
          contactId,
          title: "Head of QA",
          email: "qa@signals.test",
        },
      }),
    });
    expect(enrich.ok).toBe(true);

    const enriched = await enrich.json();
    expect(enriched.result).toMatchObject({
      contactId,
      contactName: "Agent Tool Smoke",
      fieldsUpdated: expect.arrayContaining(["title", "email"]),
    });
  });

  it("invoke rejects unknown tools", async () => {
    const response = await smokeFetch("/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "does_not_exist", input: {} }),
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      code: "TOOL_NOT_FOUND",
    });
  });
});
