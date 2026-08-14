import { test, expect } from "@playwright/test";

test.describe("smoke: agent tools API", () => {
  test("manifest lists tools", async ({ request }) => {
    const response = await request.get("/api/agent-tools");
    expect(response.ok()).toBeTruthy();

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

  test("invoke creates and enriches a contact", async ({ request }) => {
    const create = await request.post("/api/agent-tools/invoke", {
      data: {
        tool: "create_contact",
        input: {
          name: "Agent Tool Smoke",
          company: "Signals QA",
        },
      },
    });
    expect(create.ok()).toBeTruthy();

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

    const enrich = await request.post("/api/agent-tools/invoke", {
      data: {
        tool: "enrich_contact",
        input: {
          contactId,
          title: "Head of QA",
          email: "qa@signals.test",
        },
      },
    });
    expect(enrich.ok()).toBeTruthy();

    const enriched = await enrich.json();
    expect(enriched.result).toMatchObject({
      contactId,
      contactName: "Agent Tool Smoke",
      fieldsUpdated: expect.arrayContaining(["title", "email"]),
    });
  });

  test("invoke rejects unknown tools", async ({ request }) => {
    const response = await request.post("/api/agent-tools/invoke", {
      data: { tool: "does_not_exist", input: {} },
    });
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      code: "TOOL_NOT_FOUND",
    });
  });
});
