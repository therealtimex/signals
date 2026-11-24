import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const researchTargetMocks = vi.hoisted(() => ({
  prepareContactWebResearchTarget: vi.fn(),
  releaseContactWebResearchTarget: vi.fn(),
}));

vi.mock("@/lib/workflows/contact-web-research-target", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/workflows/contact-web-research-target")
  >();
  return { ...actual, ...researchTargetMocks };
});

import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createContact } from "@/lib/db/queries/contacts";
import {
  claimTemplateThreadSlug,
  createTemplate,
  getTemplate,
} from "@/lib/db/queries/workflow-templates";
import {
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowSteps,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import {
  beginWorkflowTerminalDispatch,
  readWorkflowTerminalLifecycle,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { resetCoreTables } from "@/test/db";

/**
 * #572: the shared "Contact Enrich Profile" thread must be checked before a dispatch is sent, and a
 * dispatch failure while RealTimeX is up must keep its real cause.
 */

const SHARED_THREAD = "shared-thread";
const FRESH_THREAD = "fresh-thread";

const preparedResearchTarget = {
  targetId: "target-linkedin",
  platform: "linkedin" as const,
  source: "default" as const,
  sessionName: "signals-publish",
  startUrl: "https://www.linkedin.com/in/current",
  expectedHandle: "/in/current",
  verifiedHandle: "/in/current",
  leaseId: "lease-research",
  leaseExpiresAt: 1_800_000_000,
  preparedAt: 1_799_999_400,
};

type SendResponder = (threadSlug: string) => Response;

const accepted: SendResponder = (threadSlug) =>
  new Response(
    JSON.stringify({
      success: true,
      terminalDispatchAccepted: true,
      threadSlug,
      descriptor: { id: `cli-agent:${threadSlug}-session` },
    }),
    { status: 200 },
  );

function rtxFetch(
  options: {
    send?: SendResponder;
    listedSessions?: Array<Record<string, unknown>>;
  } = {},
) {
  const send = options.send ?? accepted;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/health")) {
      return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
    }
    if (url.endsWith("/cli/get-workspace/signals")) {
      return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
    }
    if (url.endsWith(`/cli/get-thread/signals/${SHARED_THREAD}`)) {
      return new Response(
        JSON.stringify({ thread: { slug: SHARED_THREAD, name: "Contact Enrich Profile" } }),
        { status: 200 },
      );
    }
    if (url.endsWith("/cli/create-thread/signals")) {
      return new Response(JSON.stringify({ thread: { slug: FRESH_THREAD } }), { status: 200 });
    }
    const sendMatch = url.match(/\/cli\/send-message\/signals\/([^/?]+)$/);
    if (sendMatch) return send(decodeURIComponent(sendMatch[1]));
    if (url.includes("/cli/list-terminal-sessions")) {
      return new Response(
        JSON.stringify({ success: true, sessions: options.listedSessions ?? [] }),
        { status: 200 },
      );
    }
    if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes("/cli/list-browser-sessions")) {
      return new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), {
      status: 500,
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function calledUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map(([request]) => String(request));
}

function sendTargets(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return calledUrls(fetchImpl)
    .map((url) => url.match(/\/cli\/send-message\/signals\/([^/?]+)$/)?.[1])
    .filter((slug): slug is string => Boolean(slug));
}

describe("runTemplateViaRtx shared-thread liveness and error codes (#572)", () => {
  let storageDir = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    storageDir = mkdtempSync(join(tmpdir(), "signals-dispatch-liveness-"));
    env = {
      ...process.env,
      RTX_APP_ID: "test-app-id",
      RTX_API_BASE_URL: "http://127.0.0.1:3001",
      STORAGE_DIR: storageDir,
    };
    researchTargetMocks.prepareContactWebResearchTarget
      .mockReset()
      .mockResolvedValue({ ok: true, target: preparedResearchTarget });
    researchTargetMocks.releaseContactWebResearchTarget.mockReset().mockReturnValue({
      leaseId: "lease-research",
      released: true,
      alreadyGone: false,
    });
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  function researchTemplateOnSharedThread() {
    const template = createTemplate({
      name: "Contact Web Research",
      templateType: "enrichment",
      status: "active",
      config: JSON.stringify(buildContactWebResearchTemplateConfig()),
      isSystem: 1,
    });
    claimTemplateThreadSlug(template.id, null, SHARED_THREAD);
    return template;
  }

  /** A previous run of the template that was dispatched into the shared thread. */
  function previousRunOnSharedThread(
    templateId: string,
    options: {
      status: "running" | "completed" | "failed";
      dispatch:
        | { state: "accepted"; sessionId: string }
        | { state: "uncertain" | "failed"; error: string };
      result?: Record<string, unknown>;
      dispatchedAgoMs?: number;
    },
  ) {
    const dispatchedAt = Date.now() - (options.dispatchedAgoMs ?? 10 * 60 * 1000);
    const contact = createContact({ name: `Earlier ${options.status}` });
    const baseConfig = {
      ...buildContactWebResearchTemplateConfig(),
      contactId: contact.id,
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: SHARED_THREAD,
      rtxRuntimeSessionId: options.dispatch.state === "accepted" ? options.dispatch.sessionId : null,
    };
    const run = createWorkflowRun({
      templateId,
      workflowType: "enrich",
      status: options.status,
      trigger: "template",
      startedAt: Math.floor(dispatchedAt / 1000),
      config: JSON.stringify(baseConfig),
      result: JSON.stringify(options.result ?? {}),
    });
    const begun = beginWorkflowTerminalDispatch(
      run.config,
      {
        runId: run.id,
        workspaceSlug: "signals",
        threadSlug: SHARED_THREAD,
        briefPath: `/tmp/workflow-runs/${run.id}/brief.md`,
        message: `Run ${run.id}`,
      },
      dispatchedAt,
    );
    const settled = settleWorkflowTerminalDispatch(
      begun,
      options.dispatch.state === "accepted"
        ? { state: "accepted", descriptor: { id: options.dispatch.sessionId } }
        : { state: options.dispatch.state, error: options.dispatch.error },
      dispatchedAt,
    );
    updateWorkflowRun(run.id, {
      config: writeWorkflowTerminalLifecycle(JSON.stringify(baseConfig), settled),
    });
    return getWorkflowRun(run.id)!;
  }

  async function dispatchResearch(templateId: string, fetchImpl: typeof fetch) {
    const contact = createContact({ name: "Next In Cohort" });
    return runTemplateViaRtx(
      {
        templateId,
        config: { contactId: contact.id },
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      env,
      fetchImpl,
    );
  }

  it("starts a new thread when the shared thread's last handoff was never confirmed", async () => {
    const template = researchTemplateOnSharedThread();
    const previous = previousRunOnSharedThread(template.id, {
      status: "failed",
      dispatch: {
        state: "uncertain",
        error: "The receiving terminal did not confirm the message in time.",
      },
      result: { errorCode: "launch_failed" },
    });
    const fetchImpl = rtxFetch();

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({
      success: true,
      threadSlug: FRESH_THREAD,
      threadResolution: "replaced",
    });
    expect(sendTargets(fetchImpl)).toEqual([FRESH_THREAD]);
    // Signals' own record decided; RTX was not asked and nothing was sent to the dead thread.
    expect(calledUrls(fetchImpl).some((url) => url.includes("/cli/list-terminal-sessions"))).toBe(
      false,
    );
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe(FRESH_THREAD);
    if (!result.success) throw new Error(result.error);
    expect(listWorkflowSteps(result.workflowRunId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "rtx_thread_liveness",
          output: expect.stringContaining('"reason":"previous_dispatch_unconfirmed"'),
        }),
      ]),
    );
    const liveness = listWorkflowSteps(result.workflowRunId).find(
      (step) => step.tool === "rtx_thread_liveness",
    );
    expect(JSON.parse(liveness?.output ?? "{}")).toMatchObject({
      previousRunId: previous.id,
      staleThreadSlug: SHARED_THREAD,
      threadSlug: FRESH_THREAD,
    });
  });

  it("starts a new thread when the previous accepted run was lost (dispatch_lost)", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "failed",
      dispatch: { state: "accepted", sessionId: "cli-agent:lost" },
      result: { errorCode: "dispatch_lost", dispatchLost: true },
    });
    const fetchImpl = rtxFetch();

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: true, threadSlug: FRESH_THREAD });
    expect(sendTargets(fetchImpl)).toEqual([FRESH_THREAD]);
  });

  it("starts a new thread when a running run's terminal session is gone from RTX", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "running",
      dispatch: { state: "accepted", sessionId: "cli-agent:vanished" },
      dispatchedAgoMs: 5 * 60 * 1000,
    });
    // `terminal.status: idle, activeSessionCount: 0`: the thread has no live session at all.
    const fetchImpl = rtxFetch({ listedSessions: [] });

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: true, threadSlug: FRESH_THREAD });
    expect(sendTargets(fetchImpl)).toEqual([FRESH_THREAD]);
    const listCall = calledUrls(fetchImpl).find((url) =>
      url.includes("/cli/list-terminal-sessions"),
    );
    expect(listCall).toContain(`threadSlug=${SHARED_THREAD}`);
    expect(
      fetchImpl.mock.calls.find(([request]) =>
        String(request).includes("/cli/list-terminal-sessions"),
      )?.[1],
    ).toMatchObject({ method: "GET" });
  });

  it("reuses the shared thread when its last dispatch was accepted and completed", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "completed",
      dispatch: { state: "accepted", sessionId: "cli-agent:done" },
    });
    const fetchImpl = rtxFetch();

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({
      success: true,
      threadSlug: SHARED_THREAD,
      threadResolution: "reused",
    });
    expect(sendTargets(fetchImpl)).toEqual([SHARED_THREAD]);
    expect(calledUrls(fetchImpl).some((url) => url.endsWith("/cli/create-thread/signals"))).toBe(
      false,
    );
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe(SHARED_THREAD);
  });

  it("reuses the shared thread when a running run's session is still listed", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "running",
      dispatch: { state: "accepted", sessionId: "cli-agent:working" },
      dispatchedAgoMs: 5 * 60 * 1000,
    });
    const fetchImpl = rtxFetch({
      listedSessions: [
        {
          id: "cli-agent:working",
          status: "running",
          workspaceSlug: "signals",
          threadSlug: SHARED_THREAD,
        },
      ],
    });

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: true, threadSlug: SHARED_THREAD });
    expect(sendTargets(fetchImpl)).toEqual([SHARED_THREAD]);
  });

  it("keeps the shared thread when RTX cannot list its sessions (unknown is not dead)", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "running",
      dispatch: { state: "accepted", sessionId: "cli-agent:unknown" },
      dispatchedAgoMs: 5 * 60 * 1000,
    });
    const base = rtxFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/cli/list-terminal-sessions")
        ? new Response(JSON.stringify({ success: false, error: "relay down" }), { status: 502 })
        : base(input, init),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: true, threadSlug: SHARED_THREAD });
    expect(sendTargets(fetchImpl)).toEqual([SHARED_THREAD]);
  });

  it("keeps the shared thread when a previous dispatch failed for a configuration reason", async () => {
    const template = researchTemplateOnSharedThread();
    previousRunOnSharedThread(template.id, {
      status: "failed",
      dispatch: { state: "failed", error: "permission missing" },
      result: { errorCode: "permission_required" },
    });
    const fetchImpl = rtxFetch();

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: true, threadSlug: SHARED_THREAD });
  });

  it("records an unconfirmed send as an uncertain launch_failed, and the next run avoids the thread", async () => {
    const template = researchTemplateOnSharedThread();
    const unconfirmed = rtxFetch({
      send: () =>
        new Response(
          JSON.stringify({
            success: false,
            status: "delivery_unknown",
            code: "SEND_MESSAGE_OUTCOME_UNKNOWN",
            error:
              "The receiving terminal did not confirm the message in time. It may still have received it: do not send it again; check the receiving thread first.",
            terminalDispatchAccepted: false,
          }),
          { status: 409 },
        ),
    });

    const first = await dispatchResearch(template.id, unconfirmed);

    expect(first).toMatchObject({
      success: false,
      errorCode: "launch_failed",
      httpStatus: 502,
      details: { dispatchState: "uncertain" },
    });
    if (first.success || !first.workflowRunId) throw new Error("expected failed dispatch");
    const firstRun = getWorkflowRun(first.workflowRunId);
    expect(JSON.parse(firstRun?.result ?? "{}")).toMatchObject({ errorCode: "launch_failed" });
    expect(readWorkflowTerminalLifecycle(firstRun?.config)).toMatchObject({
      dispatch: { state: "uncertain", routing: { threadSlug: SHARED_THREAD } },
      cleanup: { requested: true },
    });

    // The issue's 23:58 run: same shared thread, RTX still up.
    const healthy = rtxFetch();
    const second = await dispatchResearch(template.id, healthy);

    expect(second).toMatchObject({ success: true, threadSlug: FRESH_THREAD });
    expect(sendTargets(healthy)).toEqual([FRESH_THREAD]);
  });

  it("reports a relay 5xx as launch_failed with the previous bad handoff, never rtx_unavailable", async () => {
    const template = researchTemplateOnSharedThread();
    const previous = previousRunOnSharedThread(template.id, {
      status: "failed",
      dispatch: { state: "uncertain", error: "terminal did not confirm" },
      result: { errorCode: "launch_failed" },
    });
    const fetchImpl = rtxFetch({
      send: () =>
        new Response(
          JSON.stringify({ success: false, error: "desktop relay error" }),
          { status: 500 },
        ),
    });

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({
      success: false,
      errorCode: "launch_failed",
      httpStatus: 502,
      details: {
        rtxErrorCode: "rtx_unavailable",
        rtxHttpStatus: 500,
        previousDispatch: {
          workflowRunId: previous.id,
          errorCode: "launch_failed",
          reason: "previous_dispatch_unconfirmed",
        },
      },
    });
  });

  it("still reports rtx_unavailable when RTX has no runtime-sessions surface (404)", async () => {
    const template = researchTemplateOnSharedThread();
    const fetchImpl = rtxFetch({
      send: () =>
        new Response(
          JSON.stringify({ success: false, code: "RTX_RUNTIME_SESSIONS_UNAVAILABLE" }),
          { status: 404 },
        ),
    });

    const result = await dispatchResearch(template.id, fetchImpl);

    expect(result).toMatchObject({ success: false, errorCode: "rtx_unavailable", httpStatus: 503 });
  });
});
