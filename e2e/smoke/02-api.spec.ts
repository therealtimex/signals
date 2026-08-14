import { test, expect } from "@playwright/test";

test.describe("smoke:core API", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      app: "signals",
    });
  });

  test("contacts API supports list and create", async ({ request }) => {
    const emptyList = await request.get("/api/contacts");
    expect(emptyList.ok()).toBeTruthy();
    await expect(emptyList.json()).resolves.toMatchObject({
      data: [],
      total: 0,
    });

    const create = await request.post("/api/contacts", {
      data: {
        name: "Smoke Test Contact",
        firstName: "Smoke",
        lastName: "Test",
        platform: "x",
        platformUserId: "smoke-e2e-user",
      },
    });
    expect(create.status()).toBe(201);

    const created = await create.json();
    expect(created).toMatchObject({
      name: "Smoke Test Contact",
      firstName: "Smoke",
      lastName: "Test",
    });

    const afterCreate = await request.get("/api/contacts");
    const listBody = await afterCreate.json();
    expect(listBody.total).toBe(1);
    expect(listBody.data[0].name).toBe("Smoke Test Contact");
  });

  test("contacts API rejects invalid payloads", async ({ request }) => {
    const response = await request.post("/api/contacts", {
      data: { email: "not-an-email" },
    });
    expect(response.status()).toBe(400);
  });

  test("settings API returns auth source metadata", async ({ request }) => {
    const response = await request.get("/api/settings");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toMatchObject({
      source: expect.stringMatching(/^(env_var|config|none)$/),
      hasKey: expect.any(Boolean),
    });
  });

  test("goals API supports list and create", async ({ request }) => {
    const emptyList = await request.get("/api/goals");
    expect(emptyList.ok()).toBeTruthy();
    await expect(emptyList.json()).resolves.toMatchObject({
      data: [],
      total: 0,
    });

    const create = await request.post("/api/goals", {
      data: {
        name: "Grow audience",
        goalType: "audience_growth",
        targetValue: 100,
        unit: "followers",
        platform: "x",
      },
    });
    expect(create.status()).toBe(201);

    const goal = await create.json();
    expect(goal).toMatchObject({
      name: "Grow audience",
      goalType: "audience_growth",
      targetValue: 100,
      unit: "followers",
    });
  });
});

test.describe("smoke: RTX Local App mode", () => {
  test.skip(
    !process.env.RTX_APP_ID,
    "RTX_APP_ID not set — enable when Local App bootstrap (#2) lands"
  );

  test("health reports RTX app id when embedded", async ({ request }) => {
    const response = await request.get("/api/health");
    const body = await response.json();
    expect(body.rtxAppId).toBe(process.env.RTX_APP_ID);
  });
});
