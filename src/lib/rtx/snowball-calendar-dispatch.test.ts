import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  dispatchSnowballCalendarTask,
  SNOWBALL_CALENDAR_DISPATCH_CONFIG_KEY,
  snowballCalendarWorkflowRunId,
  type SnowballCalendarDispatchContext,
} from "@/lib/rtx/snowball-calendar-dispatch";

const mocks = vi.hoisted(() => ({
  runTemplateViaRtx: vi.fn(),
  resolveSignalsRtxWorkspaceSlug: vi.fn(async () => "signals"),
  resolveNetworkSnowballDispatchThread: vi.fn(async () => "network-snowball"),
  resolveActiveTerminalSessionIdForThread: vi.fn(async () => "cli-agent:dispatcher"),
  scheduleWorkflowTerminalSessionRelease: vi.fn(() => ({
    scheduled: true,
    sessionId: "cli-agent:dispatcher",
  })),
}));

vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  runTemplateViaRtx: mocks.runTemplateViaRtx,
}));

vi.mock("@/lib/rtx/cli-provisioning", () => ({
  getSignalsRtxWorkspaceSlug: () => "signals",
  resolveSignalsRtxWorkspaceSlug: mocks.resolveSignalsRtxWorkspaceSlug,
  resolveNetworkSnowballDispatchThread: mocks.resolveNetworkSnowballDispatchThread,
}));

vi.mock("@/lib/rtx/runtime-sessions", () => ({
  resolveActiveTerminalSessionIdForThread: mocks.resolveActiveTerminalSessionIdForThread,
}));

vi.mock("@/lib/rtx/resource-teardown", () => ({
  scheduleWorkflowTerminalSessionRelease: mocks.scheduleWorkflowTerminalSessionRelease,
}));

const context: SnowballCalendarDispatchContext = {
  calendarEventUuid: "event-1",
  taskUuid: "70e9bcc5-348f-49ff-a12a-4d99d8bc7838",
  dispatchKind: "workflow.run",
  workflowTemplate: "Network Snowball",
  workflowRunConfig: {
    seedType: "event_url",
    seedValue: "https://www.linkedin.com/posts/acme-1",
    focus: "all_connected",
  },
};

function seedTemplate() {
  return createTemplate({
    name: "Network Snowball",
    templateType: "prospecting",
    status: "active",
    isSystem: 1,
    config: JSON.stringify({ networkSnowball: { version: 1 } }),
  });
}

describe("Snowball Calendar dispatch", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.clearAllMocks();
    mocks.resolveSignalsRtxWorkspaceSlug.mockResolvedValue("signals");
    mocks.resolveNetworkSnowballDispatchThread.mockResolvedValue("network-snowball");
    mocks.resolveActiveTerminalSessionIdForThread.mockResolvedValue("cli-agent:dispatcher");
    mocks.scheduleWorkflowTerminalSessionRelease.mockReturnValue({
      scheduled: true,
      sessionId: "cli-agent:dispatcher",
    });
  });

  it("launches once, acknowledges the Calendar task, and releases the dispatcher", async () => {
    const template = seedTemplate();
    mocks.runTemplateViaRtx.mockImplementation(async (input: { existingRunId: string }) => {
      updateWorkflowRun(input.existingRunId, { status: "running" });
      return {
        success: true,
        workflowRunId: input.existingRunId,
        workspaceSlug: "signals",
        threadSlug: "network-snowball-workflow",
        threadPath: "/workspace/signals/t/network-snowball-workflow",
        workflowRun: getWorkflowRun(input.existingRunId),
      };
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const first = await dispatchSnowballCalendarTask(
      context,
      "http://127.0.0.1:3010",
      { RTX_API_BASE_URL: "http://127.0.0.1:3101" },
      fetchImpl,
    );

    const runId = snowballCalendarWorkflowRunId(context.taskUuid);
    expect(first).toMatchObject({
      success: true,
      workflowRunId: runId,
      workflowStatus: "running",
      duplicate: false,
      calendarTaskAcknowledged: true,
      dispatcherTerminalSessionId: "cli-agent:dispatcher",
      dispatcherReleaseScheduled: true,
    });
    expect(mocks.runTemplateViaRtx).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: template.id,
        existingRunId: runId,
        signalsBaseUrl: "http://127.0.0.1:3010",
        config: expect.objectContaining({
          seedValue: "https://www.linkedin.com/posts/acme-1",
          [SNOWBALL_CALENDAR_DISPATCH_CONFIG_KEY]: {
            version: 1,
            taskUuid: context.taskUuid,
            calendarEventUuid: context.calendarEventUuid,
          },
        }),
      }),
      expect.anything(),
      fetchImpl,
    );
    const [webhookUrl, webhookInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(webhookUrl).toBe(
      `http://127.0.0.1:3101/api/external-tasks/${context.taskUuid}/webhook`,
    );
    expect(JSON.parse(String(webhookInit.body))).toMatchObject({
      action: "completed",
      machine_id: "signals",
      data: { agent_name: "cursor", workflowRunId: runId },
    });
    expect(mocks.scheduleWorkflowTerminalSessionRelease).toHaveBeenCalledWith(
      "cli-agent:dispatcher",
      expect.anything(),
      fetchImpl,
    );

    const repeated = await dispatchSnowballCalendarTask(
      context,
      "http://127.0.0.1:3010",
      { RTX_API_BASE_URL: "http://127.0.0.1:3101" },
      fetchImpl,
    );
    expect(repeated).toMatchObject({ success: true, duplicate: true, workflowRunId: runId });
    expect(mocks.runTemplateViaRtx).toHaveBeenCalledTimes(1);
  });

  it("marks the Calendar task failed when Signals cannot launch the workflow", async () => {
    seedTemplate();
    mocks.runTemplateViaRtx.mockImplementation(async (input: { existingRunId: string }) => {
      updateWorkflowRun(input.existingRunId, { status: "failed" });
      return {
        success: false,
        error: "LinkedIn browser target unavailable",
        errorCode: "snowball_browser_target_unavailable",
        httpStatus: 409,
        workflowRunId: input.existingRunId,
      };
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await dispatchSnowballCalendarTask(
      context,
      "http://127.0.0.1:3010",
      { RTX_API_BASE_URL: "http://127.0.0.1:3101" },
      fetchImpl,
    );

    expect(result).toMatchObject({
      success: false,
      workflowStatus: "failed",
      calendarTaskAcknowledged: true,
      error: "LinkedIn browser target unavailable",
      dispatcherReleaseScheduled: true,
    });
    const [, webhookInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(webhookInit.body))).toMatchObject({
      action: "failed",
      data: { error: { message: "LinkedIn browser target unavailable" } },
    });
  });

  it("retries transient Calendar acknowledgement failures", async () => {
    seedTemplate();
    mocks.runTemplateViaRtx.mockImplementation(async (input: { existingRunId: string }) => {
      updateWorkflowRun(input.existingRunId, { status: "running" });
      return {
        success: true,
        workflowRunId: input.existingRunId,
        workspaceSlug: "signals",
        threadSlug: "network-snowball-workflow",
        threadPath: "/workspace/signals/t/network-snowball-workflow",
        workflowRun: getWorkflowRun(input.existingRunId),
      };
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await dispatchSnowballCalendarTask(
      context,
      "http://127.0.0.1:3010",
      { RTX_API_BASE_URL: "http://127.0.0.1:3101" },
      fetchImpl,
    );

    expect(result).toMatchObject({
      success: true,
      calendarTaskAcknowledged: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
