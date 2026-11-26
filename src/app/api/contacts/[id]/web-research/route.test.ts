import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createContact } from "@/lib/db/queries/contacts";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_WEB_RESEARCH_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  runTemplateViaRtx: vi.fn(async () => ({
    success: true,
    workflowRunId: "run-contact-web-1",
    threadPath: "Signals/Contact Web Research",
  })),
}));

const mockedRunTemplate = vi.mocked(runTemplateViaRtx);

describe("/api/contacts/[id]/web-research", () => {
  beforeEach(() => {
    resetCoreTables();
    mockedRunTemplate.mockClear();
  });

  it("returns 404 for an unknown contact", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/contacts/missing/web-research");
    expect((await GET(req, { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    expect(
      (await POST(new NextRequest(req.url, { method: "POST" }), {
        params: Promise.resolve({ id: "missing" }),
      })).status,
    ).toBe(404);
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });

  it("returns idle state before the first run", async () => {
    const contact = createContact({ name: "Idle Contact" });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
    );
    const response = await GET(req, { params: Promise.resolve({ id: contact.id }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "idle", workflowRunId: null });
  });

  it("dispatches the seeded template with the contact id", async () => {
    const contact = createContact({ name: "Sparse Contact" });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
      { method: "POST" },
    );
    const response = await POST(req, { params: Promise.resolve({ id: contact.id }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ workflowRunId: "run-contact-web-1" });
    expect(mockedRunTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ config: { contactId: contact.id } }),
    );
  });

  it("rejects duplicate dispatch while web research is running", async () => {
    const contact = createContact({ name: "Already Researching" });
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      config: JSON.stringify({ contactId: contact.id }),
      trigger: "template",
    });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
      { method: "POST" },
    );
    const response = await POST(req, { params: Promise.resolve({ id: contact.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ENRICHMENT_IN_PROGRESS" });
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });

  describe("#572 dispatch failures", () => {
    const post = (contactId: string) =>
      POST(
        new NextRequest(`http://127.0.0.1:3000/api/contacts/${contactId}/web-research`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: contactId }) },
      );

    it("re-reads the state when a completion lands during the liveness check (PR #574 review W5)", async () => {
      const contact = createContact({ name: "Completes Mid Check" });
      seedTemplates();
      const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
      const stale = Math.floor(Date.now() / 1000) - 30 * 60;
      const run = createWorkflowRun({
        templateId: template.id,
        workflowType: "enrich",
        status: "running",
        trigger: "template",
        startedAt: stale,
        config: JSON.stringify({
          ...buildContactWebResearchTemplateConfig(),
          contactId: contact.id,
          rtxWorkspaceSlug: "signals",
          rtxThreadSlug: "contact-enrich-profile",
          rtxRuntimeSessionId: "cli-agent:mid-check",
        }),
      });
      db.update(workflowRuns)
        .set({ createdAt: stale, updatedAt: stale })
        .where(eq(workflowRuns.id, run.id))
        .run();
      // The agent's complete_workflow_run lands while the route waits on RTX, whose listing still
      // shows the turn busy, so the watchdog releases nothing.
      const rtxFetch = vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).includes("/cli/list-terminal-sessions")) {
          return new Response(JSON.stringify({ error: `Unexpected request: ${String(input)}` }), {
            status: 500,
          });
        }
        db.update(workflowRuns)
          .set({ status: "completed", completedAt: Math.floor(Date.now() / 1000), result: "{}" })
          .where(eq(workflowRuns.id, run.id))
          .run();
        return new Response(
          JSON.stringify({
            success: true,
            sessions: [
              {
                id: "cli-agent:mid-check",
                chatLinkedTurnStateKnown: true,
                chatLinkedPendingTurn: { id: "turn", state: "capturing" },
              },
            ],
          }),
          { status: 200 },
        );
      });
      vi.stubEnv("RTX_APP_ID", "signals");
      vi.stubEnv("RTX_API_BASE_URL", "http://127.0.0.1:3999");
      vi.stubGlobal("fetch", rtxFetch);
      try {
        const response = await post(contact.id);

        expect(rtxFetch).toHaveBeenCalledTimes(1);
        expect(getWorkflowRun(run.id)?.status).toBe("completed");
        expect(response.status).toBe(202);
        expect(mockedRunTemplate).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    });

    it("fails a lost run inline and dispatches again instead of answering 409", async () => {
      const contact = createContact({ name: "Lost In Dispatch" });
      seedTemplates();
      const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
      const stale = Math.floor(Date.now() / 1000) - 30 * 60;
      const lost = createWorkflowRun({
        templateId: template.id,
        workflowType: "enrich",
        status: "running",
        trigger: "template",
        startedAt: stale,
        config: JSON.stringify({
          ...buildContactWebResearchTemplateConfig(),
          contactId: contact.id,
        }),
      });
      db.update(workflowRuns)
        .set({ createdAt: stale, updatedAt: stale })
        .where(eq(workflowRuns.id, lost.id))
        .run();

      const response = await post(contact.id);

      expect(response.status).toBe(202);
      expect(getWorkflowRun(lost.id)?.status).toBe("failed");
      expect(JSON.parse(getWorkflowRun(lost.id)?.result ?? "{}")).toMatchObject({
        errorCode: "dispatch_lost",
      });
      expect(mockedRunTemplate).toHaveBeenCalledOnce();
    });

    it("reports a lost run as failed/dispatch_lost on GET", async () => {
      const contact = createContact({ name: "Polled" });
      seedTemplates();
      const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
      const stale = Math.floor(Date.now() / 1000) - 30 * 60;
      const lost = createWorkflowRun({
        templateId: template.id,
        workflowType: "enrich",
        status: "pending",
        trigger: "template",
        config: JSON.stringify({
          ...buildContactWebResearchTemplateConfig(),
          contactId: contact.id,
        }),
      });
      db.update(workflowRuns)
        .set({ createdAt: stale, updatedAt: stale })
        .where(eq(workflowRuns.id, lost.id))
        .run();

      const response = await GET(
        new NextRequest(`http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`),
        { params: Promise.resolve({ id: contact.id }) },
      );

      await expect(response.json()).resolves.toMatchObject({
        status: "failed",
        errorCode: "dispatch_lost",
        workflowRunId: lost.id,
      });
    });

    it("still answers 409 while a research run is inside its liveness window", async () => {
      const contact = createContact({ name: "Recently Dispatched" });
      seedTemplates();
      const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
      createWorkflowRun({
        templateId: template.id,
        workflowType: "enrich",
        status: "running",
        trigger: "template",
        startedAt: Math.floor(Date.now() / 1000) - 60,
        config: JSON.stringify({
          ...buildContactWebResearchTemplateConfig(),
          contactId: contact.id,
        }),
      });

      const response = await post(contact.id);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "ENRICHMENT_IN_PROGRESS" });
      expect(mockedRunTemplate).not.toHaveBeenCalled();
    });

    it("keeps launch_failed and the previous bad handoff instead of RTX_UNAVAILABLE", async () => {
      const contact = createContact({ name: "After Bad Handoff" });
      mockedRunTemplate.mockResolvedValueOnce({
        success: false,
        error: "desktop relay error",
        errorCode: "launch_failed",
        httpStatus: 502,
        workflowRunId: "run-after-bad-handoff",
        details: {
          dispatchState: "failed",
          rtxErrorCode: "rtx_unavailable",
          previousDispatch: {
            workflowRunId: "run-unconfirmed",
            errorCode: "launch_failed",
            reason: "previous_dispatch_unconfirmed",
          },
        },
      });

      const response = await post(contact.id);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: "desktop relay error",
        code: "launch_failed",
        details: {
          workflowRunId: "run-after-bad-handoff",
          previousDispatch: { workflowRunId: "run-unconfirmed", errorCode: "launch_failed" },
        },
      });
    });

    it("passes dispatch_lost through with its own code", async () => {
      const contact = createContact({ name: "Lost Code" });
      mockedRunTemplate.mockResolvedValueOnce({
        success: false,
        error: "dispatch_lost: never reported back",
        errorCode: "dispatch_lost",
        httpStatus: 502,
        workflowRunId: "run-lost",
      });

      const response = await post(contact.id);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ code: "dispatch_lost" });
    });

    it("reserves RTX_UNAVAILABLE for an unreachable runtime and keeps its real message", async () => {
      const contact = createContact({ name: "No Runtime" });
      mockedRunTemplate.mockResolvedValueOnce({
        success: false,
        error: "RealTimeX desktop runtime sessions are not available on this host.",
        errorCode: "rtx_unavailable",
        httpStatus: 503,
        workflowRunId: "run-no-runtime",
      });

      const response = await post(contact.id);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "RTX_UNAVAILABLE",
        error: "RealTimeX desktop runtime sessions are not available on this host.",
      });
    });

    it("says research needs RealTimeX only when Signals runs standalone", async () => {
      const contact = createContact({ name: "Standalone" });
      mockedRunTemplate.mockResolvedValueOnce({
        success: false,
        error: "Agent workflows require the RealTimeX Local App",
        errorCode: "standalone",
        httpStatus: 400,
      });

      const response = await post(contact.id);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "RTX_UNAVAILABLE",
        error: "Contact web research is available inside RealTimeX",
      });
    });
  });

  it("maps an unavailable authenticated target to an actionable 409", async () => {
    const contact = createContact({ name: "Needs Browser Login" });
    mockedRunTemplate.mockResolvedValueOnce({
      success: false,
      error: "LinkedIn is signed out. Open Settings → Platform connections.",
      errorCode: "research_target_unavailable",
      httpStatus: 409,
      workflowRunId: "run-target-failed",
      details: {
        reason: "LOGIN_REQUIRED",
        targetId: "target-linkedin",
        settingsPath: "/dashboard/settings?tab=platforms",
        settingsTab: "Platform connections",
      },
    });

    const response = await POST(
      new NextRequest(
        `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: contact.id }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESEARCH_TARGET_UNAVAILABLE",
      details: {
        reason: "LOGIN_REQUIRED",
        settingsPath: "/dashboard/settings?tab=platforms",
        workflowRunId: "run-target-failed",
      },
    });
  });
});
