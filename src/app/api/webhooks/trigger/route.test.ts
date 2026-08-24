import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { POST } from "./route";
import { NextRequest } from "next/server";
import { buildSignedWebhookHeaders } from "@/lib/webhooks/workflow-events";

describe("POST /api/webhooks/trigger", () => {
  beforeEach(() => {
    resetCoreTables();
    delete process.env.SIGNALS_WEBHOOK_SECRET;
    delete process.env.REALTIMEX_WEBHOOK_SECRET;
  });

  it("triggers a Network Snowball run successfully without auth when secret is unset", async () => {
    createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
      config: JSON.stringify({ focus: "investors_and_angels" }),
    });

    const body = JSON.stringify({
      templateName: "Network Snowball",
      seedValue: "https://x.com/spectre_intel/status/123",
      focus: "investors_and_angels",
      followOnActions: ["profile_pipeline"],
    });

    const req = new NextRequest("http://localhost:3000/api/webhooks/trigger", {
      method: "POST",
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.templateName).toBe("Network Snowball");
  });

  it("verifies HMAC signature when secret is configured", async () => {
    process.env.SIGNALS_WEBHOOK_SECRET = "secret-test-key-123";

    createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const body = JSON.stringify({
      templateName: "Network Snowball",
      seedValue: "https://linkedin.com/posts/xyz",
    });

    // 1. Request with invalid signature
    const badReq = new NextRequest("http://localhost:3000/api/webhooks/trigger", {
      method: "POST",
      headers: { "x-realtimex-signature": "sha256=invalidhex" },
      body,
    });

    const badRes = await POST(badReq);
    expect(badRes.status).toBe(401);

    // 2. Request with valid HMAC signature
    const signedHeaders = buildSignedWebhookHeaders(body, {
      secret: "secret-test-key-123",
    });

    const goodReq = new NextRequest("http://localhost:3000/api/webhooks/trigger", {
      method: "POST",
      headers: signedHeaders,
      body,
    });

    const goodRes = await POST(goodReq);
    expect(goodRes.status).toBe(200);
    const goodData = await goodRes.json();
    expect(goodData.success).toBe(true);
    expect(goodData.runId).toBeDefined();
  });
});
