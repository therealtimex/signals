import { afterEach, describe, expect, it } from "vitest";
import { smokeBaseUrl, smokeFetch, smokeJson } from "./http-client";

const createdContacts: string[] = [];
const createdGoals: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...createdContacts.splice(0).map((id) => smokeFetch(`/api/contacts/${id}`, { method: "DELETE" })),
    ...createdGoals.splice(0).map((id) => smokeFetch(`/api/goals/${id}`, { method: "DELETE" })),
  ]);
});

describe("smoke:core API", () => {
  it("health endpoint returns ok", async () => {
    const response = await smokeFetch("/api/health");
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      app: "signals",
      cliPackage: "@realtimex/signals-pp-cli",
      rtx: {
        mode: "standalone",
        appId: null,
        manifest: "signals",
      },
    });
    expect(body.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rtx status endpoint exposes manifest", async () => {
    const body = await smokeJson<{ manifest: { id: string }; permissions: string[] }>(
      "/api/rtx/status"
    );
    expect(body.manifest.id).toBe("signals");
    expect(body.permissions).toContain("credentials.use");
    expect(body.permissions).toContain("llm.embed");
    expect(body.permissions).toContain("llm.chat");
  });

  it("contacts API supports list and create", async () => {
    const emptyList = await smokeFetch("/api/contacts");
    expect(emptyList.ok).toBe(true);
    await expect(emptyList.json()).resolves.toMatchObject({
      data: [],
      total: 0,
    });

    const create = await smokeFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Test Contact",
        firstName: "Smoke",
        lastName: "Test",
        identity: {
          platform: "x",
          platformUserId: "smoke-e2e-user",
        },
      }),
    });
    expect(create.status).toBe(201);

    const created = await create.json();
    createdContacts.push(created.id as string);
    expect(created).toMatchObject({
      name: "Smoke Test Contact",
      firstName: "Smoke",
      lastName: "Test",
    });
    expect(created.identities).toHaveLength(1);
    expect(created.identities[0]).toMatchObject({
      platform: "x",
      platformUserId: "smoke-e2e-user",
    });

    const afterCreate = await smokeFetch("/api/contacts");
    const listBody = await afterCreate.json();
    expect(listBody.total).toBe(1);
    expect(listBody.data[0].name).toBe("Smoke Test Contact");
  });

  it("contacts API rejects invalid payloads", async () => {
    const response = await smokeFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(response.status).toBe(400);
  });

  it("settings API returns auth source metadata", async () => {
    const response = await smokeFetch("/api/settings");
    expect(response.ok).toBe(true);

    const body = await response.json();
    expect(body).toMatchObject({
      source: expect.stringMatching(/^(env_var|config|none)$/),
      hasKey: expect.any(Boolean),
    });
  });

  it("goals API supports list and create", async () => {
    const emptyList = await smokeFetch("/api/goals");
    expect(emptyList.ok).toBe(true);
    await expect(emptyList.json()).resolves.toMatchObject({
      data: [],
      total: 0,
    });

    const create = await smokeFetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Grow audience",
        goalType: "audience_growth",
        targetValue: 100,
        unit: "followers",
        platform: "x",
      }),
    });
    expect(create.status).toBe(201);

    const goal = await create.json();
    createdGoals.push(goal.id as string);
    expect(goal).toMatchObject({
      name: "Grow audience",
      goalType: "audience_growth",
      targetValue: 100,
      unit: "followers",
    });
  });
});

describe("smoke: RTX Local App mode", () => {
  it.skipIf(!process.env.RTX_APP_ID)(
    "health reports embedded RTX mode when RTX_APP_ID is set",
    async () => {
      const body = await smokeJson<{ rtx: { mode: string; appId: string | null } }>(
        "/api/health"
      );
      expect(body.rtx).toMatchObject({
        mode: "embedded",
        appId: process.env.RTX_APP_ID,
      });
    }
  );
});
