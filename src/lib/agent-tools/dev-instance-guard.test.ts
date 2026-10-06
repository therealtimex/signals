import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as invokeRoute } from "@/app/api/agent-tools/invoke/route";
import { PATCH as patchEmailCandidate } from "@/app/api/email-candidates/[id]/route";
import { POST as discoverTargets } from "@/app/api/platform-targets/discover/route";
import { POST as verifyTarget } from "@/app/api/platform-targets/[id]/verify/route";
import { agentToolErrorStatus } from "@/lib/agent-tools/http-status";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AgentToolError } from "@/lib/agent-tools/types";
import { toErrorResponse } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import { browserSessionLeases, contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { ensureBrowserConnection, registerPlatformTarget } from "@/lib/db/queries/platform-targets";
import { ExternalEffectDeniedError } from "@/lib/instance/guard";
import { resetCoreTables } from "@/test/db";

// MX lookups resolve to TEST-NET-1, so the real probe path is reachable without DNS and without
// any reachable mail server even if the guard regressed.
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  resolveMx: vi.fn(async () => [{ exchange: "192.0.2.1", priority: 10 }]),
}));

function seedEmailCandidate() {
  const org = createOrg({ name: "Probe Co", domain: "probe.example" });
  const contact = createContact({ name: "Pat Probe" });
  const id = nanoid();
  db.insert(contactEmailCandidates).values({
    id,
    contactId: contact.id,
    orgId: org.id,
    address: "pat@probe.example",
    addressNormalized: "pat@probe.example",
    status: "predicted",
    confidence: "high",
    source: "test",
  }).run();
  return id;
}

function seedPublishSessionTarget() {
  const connection = ensureBrowserConnection({ sessionName: "signals-publish", kind: "shared" });
  return registerPlatformTarget({
    connectionId: connection.id,
    platform: "x",
    kind: "account",
    name: "Owner",
    handle: "@owner",
    capabilities: ["browse", "publish"],
    source: "test",
  });
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", host: "127.0.0.1:3000" },
    body: JSON.stringify(body),
  });
}

describe("DEV_INSTANCE_GUARD error mapping (ADR-541-5)", () => {
  it("maps the agent-tool code to HTTP 403", () => {
    expect(agentToolErrorStatus("DEV_INSTANCE_GUARD")).toBe(403);
  });

  it("maps the guard error through the shared API error handler to 403, not 500", async () => {
    const response = toErrorResponse(new ExternalEffectDeniedError("publish.x-api"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect: "publish.x-api",
    });
  });
});

describe("guarded agent tools and routes on a Dev instance (ADR-541-5)", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    vi.stubEnv("SIGNALS_EMAIL_SMTP_PROBE_ENABLED", "1");
    vi.stubEnv("RTX_APP_ID", "app-test");
    vi.stubEnv("RTX_API_BASE_URL", "http://127.0.0.1:3101");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("update_email_candidate probe throws DEV_INSTANCE_GUARD and leaves the candidate untouched", async () => {
    const candidateId = seedEmailCandidate();

    let thrown: unknown;
    try {
      await invokeAgentTool("update_email_candidate", { candidateId, action: "probe" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentToolError);
    expect(thrown).toMatchObject({
      code: "DEV_INSTANCE_GUARD",
      details: { effect: "email.smtp-probe" },
    });
    expect(
      db.select().from(contactEmailCandidates).where(eq(contactEmailCandidates.id, candidateId)).get(),
    ).toMatchObject({ status: "predicted", probeAttempts: 0 });
  });

  it("the invoke route answers 403 DEV_INSTANCE_GUARD", async () => {
    const candidateId = seedEmailCandidate();

    const response = await invokeRoute(
      jsonRequest("http://127.0.0.1:3000/api/agent-tools/invoke", "POST", {
        tool: "update_email_candidate",
        input: { candidateId, action: "probe" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      details: { effect: "email.smtp-probe" },
    });
  });

  it("PATCH /api/email-candidates/:id probe answers 403", async () => {
    const candidateId = seedEmailCandidate();

    const response = await patchEmailCandidate(
      new Request(`http://127.0.0.1:3000/api/email-candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "probe" }),
      }),
      { params: Promise.resolve({ id: candidateId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "DEV_INSTANCE_GUARD", effect: "email.smtp-probe" });
  });

  it("prepare_platform_target on signals-publish answers 403 with no RTX call and no lease", async () => {
    const target = seedPublishSessionTarget();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeRoute(
      jsonRequest("http://127.0.0.1:3000/api/agent-tools/invoke", "POST", {
        tool: "prepare_platform_target",
        input: { targetId: target.id, intent: "browse" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "DEV_INSTANCE_GUARD",
      details: { effect: "browser-session.publish" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.select().from(browserSessionLeases).all()).toHaveLength(0);
  });

  it("platform-target verify and discover routes answer 403 with no RTX call", async () => {
    const target = seedPublishSessionTarget();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const verify = await verifyTarget(new Request("http://127.0.0.1:3000/x", { method: "POST" }), {
      params: Promise.resolve({ id: target.id }),
    });
    const discover = await discoverTargets(
      new Request("http://127.0.0.1:3000/api/platform-targets/discover", {
        method: "POST",
        body: JSON.stringify({ platform: "x" }),
      }),
    );

    for (const response of [verify, discover]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "DEV_INSTANCE_GUARD",
        effect: "browser-session.publish",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.select().from(browserSessionLeases).all()).toHaveLength(0);
  });
});
