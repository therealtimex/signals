import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { getContactById } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import { resetCoreTables } from "@/test/db";

async function invoke(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

describe("workflow import attribution journey", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("preserves new and deduplicated contacts through idempotent record and completion", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
    });

    const existingResponse = await invoke("create_contact", { name: "Existing Contact" });
    const existingId = existingResponse.body.result.id as string;
    const createdResponse = await invoke("create_contact", {
      name: "New Contact",
      workflowRunId: run.id,
      templateId: template.id,
    });
    const createdId = createdResponse.body.result.id as string;

    const recorded = await invoke("record_workflow_run_contacts", {
      runId: run.id,
      templateId: template.id,
      contactIds: [createdId, existingId],
    });
    expect(recorded.response.status).toBe(200);
    expect(recorded.body.result).toMatchObject({
      cohortSize: 2,
      addedContactIds: [createdId, existingId],
      processedItems: 2,
    });

    const repeated = await invoke("record_workflow_run_contacts", {
      runId: run.id,
      templateId: template.id,
      contactIds: [createdId, existingId],
    });
    expect(repeated.response.status).toBe(200);
    expect(repeated.body.result).toMatchObject({
      cohortSize: 2,
      addedContactIds: [],
      alreadyRecorded: 2,
      processedItems: 2,
    });

    expect(getContactById(existingId)).toMatchObject({
      createdWorkflowRunId: null,
      createdTemplateId: null,
    });
    expect(getContactById(createdId)).toMatchObject({
      createdWorkflowRunId: run.id,
      createdTemplateId: template.id,
    });

    let emittedBody = "";
    vi.stubEnv("REALTIMEX_WEBHOOK_URL", "https://example.test/workflow-completed");
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      emittedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    const completed = await invoke("complete_workflow_run", {
      runId: run.id,
      status: "completed",
    });
    expect(completed.response.status).toBe(200);
    expect(completed.body.result).toMatchObject({
      processedItems: 2,
      createdContactIds: [createdId, existingId],
      cohortSources: ["stored", "birth"],
    });

    const event = JSON.parse(emittedBody) as {
      createdContactIds: string[];
      totalProcessed: number;
    };
    expect(event.createdContactIds).toEqual([createdId, existingId]);
    expect(event.totalProcessed).toBe(2);

    const completedRun = getWorkflowRun(run.id)!;
    expect(completedRun.processedItems).toBe(2);
    expect(JSON.parse(completedRun.result ?? "{}").createdContactIds).toEqual([
      createdId,
      existingId,
    ]);
  });
});
