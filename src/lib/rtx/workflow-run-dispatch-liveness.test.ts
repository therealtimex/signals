import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import {
  createWorkflowRun,
  createWorkflowStep,
  failActiveWorkflowRunIfUnchanged,
  getWorkflowRun,
  listWorkflowSteps,
} from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME, seedTemplates } from "@/lib/db/seed-templates";
import { getContactWebResearchState } from "@/lib/contacts/web-research-state";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import {
  beginWorkflowTerminalDispatch,
  readWorkflowTerminalLifecycle,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import {
  DEFAULT_WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS,
  WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_ENV,
  getWorkflowRunHeartbeatAtMs,
  isWorkflowRunDispatchLivenessExpired,
  releaseLostWorkflowDispatch,
  releaseLostWorkflowDispatches,
  resolveWorkflowDispatchLivenessTimeoutMs,
} from "@/lib/rtx/workflow-run-terminal-watchdog";
import { runWorkflowTerminalMaintenancePass } from "@/lib/rtx/workflow-terminal-reconciler-runner";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { buildNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { acquireSessionLease, getSessionLeaseById } from "@/lib/leases/session-lease";
import { resetCoreTables } from "@/test/db";

/**
 * #572: a Contact Web Research run that never calls `complete_workflow_run` and shows no heartbeat
 * must fail as `dispatch_lost`, so its contact can be researched again.
 */

const RTX_ENV = {
  RTX_APP_ID: "signals",
  RTX_API_BASE_URL: "http://127.0.0.1:3001",
};

const minutesAgoSec = (minutes: number) => Math.floor(Date.now() / 1000) - minutes * 60;

/** Force timestamps the query helpers would otherwise stamp with "now". */
function backdate(runId: string, fields: { createdAt?: number; updatedAt?: number }) {
  db.update(workflowRuns).set(fields).where(eq(workflowRuns.id, runId)).run();
}

function sessionsFetch(sessions: Array<Record<string, unknown>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/cli/list-terminal-sessions")) {
      return new Response(JSON.stringify({ success: true, sessions }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function sentMessages(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.filter(([request]) =>
    String(request).includes("/cli/send-message/"),
  );
}

describe("Contact Web Research dispatch-liveness watchdog (#572)", () => {
  let templateId: string;

  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    seedTemplates();
    templateId = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!.id;
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
  });

  /** A research run accepted by RTX `minutes` ago that has not been heard from since. */
  function acceptedResearchRun(
    contactId: string,
    minutes: number,
    sessionId = `cli-agent:${contactId}`,
    extraConfig: Record<string, unknown> = {},
  ) {
    const at = minutesAgoSec(minutes);
    const baseConfig = {
      ...buildContactWebResearchTemplateConfig(),
      contactId,
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: "contact-enrich-profile",
      rtxRuntimeSessionId: sessionId,
      ...extraConfig,
    };
    const lifecycle = settleWorkflowTerminalDispatch(
      beginWorkflowTerminalDispatch(
        "{}",
        {
          runId: "pending-id",
          workspaceSlug: "signals",
          threadSlug: "contact-enrich-profile",
          briefPath: "/tmp/brief.md",
          message: "Run",
        },
        at * 1000,
      ),
      { state: "accepted", descriptor: { id: sessionId } },
      at * 1000,
    );
    const run = createWorkflowRun({
      templateId,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      startedAt: at,
      config: writeWorkflowTerminalLifecycle(JSON.stringify(baseConfig), lifecycle),
    });
    backdate(run.id, { createdAt: at, updatedAt: at });
    return getWorkflowRun(run.id)!;
  }

  it("uses a 15-minute default and honours the env override", () => {
    expect(DEFAULT_WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_ENV).toBe("WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS");
    expect(resolveWorkflowDispatchLivenessTimeoutMs({})).toBe(15 * 60 * 1000);
    expect(
      resolveWorkflowDispatchLivenessTimeoutMs({ WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS: "" }),
    ).toBe(15 * 60 * 1000);
    expect(
      resolveWorkflowDispatchLivenessTimeoutMs({ WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS: "nope" }),
    ).toBe(15 * 60 * 1000);
    expect(
      resolveWorkflowDispatchLivenessTimeoutMs({ WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS: "0" }),
    ).toBe(15 * 60 * 1000);
    expect(
      resolveWorkflowDispatchLivenessTimeoutMs({ WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS: "60000" }),
    ).toBe(60_000);
  });

  it("takes the newest of row, step and dispatch timestamps as the heartbeat", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const run = {
      config: "{}",
      createdAt: nowSec - 3600,
      startedAt: nowSec - 3600,
      updatedAt: nowSec - 1800,
    };
    expect(getWorkflowRunHeartbeatAtMs(run)).toBe((nowSec - 1800) * 1000);
    expect(getWorkflowRunHeartbeatAtMs(run, nowSec - 60)).toBe((nowSec - 60) * 1000);
    expect(
      isWorkflowRunDispatchLivenessExpired({ ...run, status: "running" }, nowSec - 60),
    ).toBe(false);
    expect(isWorkflowRunDispatchLivenessExpired({ ...run, status: "running" }, null)).toBe(true);
    expect(isWorkflowRunDispatchLivenessExpired({ ...run, status: "completed" }, null)).toBe(
      false,
    );
  });

  it("fails a timed-out running run as dispatch_lost and clears the contact's pending state", async () => {
    const contact = createContact({ name: "Stuck Running" });
    const run = acceptedResearchRun(contact.id, 20);
    expect(getContactWebResearchState(contact.id).status).toBe("pending");
    // The thread shows `idle, activeSessionCount: 0`.
    const fetchImpl = sessionsFetch([]);

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, fetchImpl);

    expect(sweep.released).toEqual([run.id]);
    const failed = getWorkflowRun(run.id);
    expect(failed).toMatchObject({ status: "failed", completedAt: expect.any(Number) });
    expect(JSON.parse(failed?.result ?? "{}")).toMatchObject({
      errorCode: "dispatch_lost",
      dispatchLost: true,
      livenessTimeoutMs: 15 * 60 * 1000,
    });
    expect(JSON.parse(failed?.errors ?? "[]")[0]).toMatch(/^dispatch_lost:/);
    expect(listWorkflowSteps(run.id)).toEqual([
      expect.objectContaining({
        tool: "workflow_dispatch_watchdog",
        status: "failed",
        output: expect.stringContaining('"code":"dispatch_lost"'),
      }),
    ]);
    expect(readWorkflowTerminalLifecycle(failed?.config)?.cleanup).toMatchObject({
      requested: true,
      reason: "workflow_dispatch_lost_resumable",
    });
    expect(getContactWebResearchState(contact.id)).toMatchObject({
      status: "failed",
      errorCode: "dispatch_lost",
      workflowRunId: run.id,
    });
    // Liveness is read with one GET; the watchdog never sends anything to a terminal.
    expect(sentMessages(fetchImpl)).toHaveLength(0);
  });

  it("fails a timed-out pending run that never reached a terminal, without asking RTX", async () => {
    const contact = createContact({ name: "Stuck Pending" });
    const at = minutesAgoSec(30);
    const run = createWorkflowRun({
      templateId,
      workflowType: "enrich",
      status: "pending",
      trigger: "template",
      config: JSON.stringify({ ...buildContactWebResearchTemplateConfig(), contactId: contact.id }),
    });
    backdate(run.id, { createdAt: at, updatedAt: at });
    expect(getContactWebResearchState(contact.id).status).toBe("pending");
    const fetchImpl = sessionsFetch([]);

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, fetchImpl);

    expect(sweep.released).toEqual([run.id]);
    expect(getWorkflowRun(run.id)?.status).toBe("failed");
    expect(getContactWebResearchState(contact.id)).toMatchObject({
      status: "failed",
      errorCode: "dispatch_lost",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leaves runs inside the window alone and uses the configured timeout", async () => {
    const contact = createContact({ name: "Healthy Run" });
    const run = acceptedResearchRun(contact.id, 5);
    const fetchImpl = sessionsFetch([]);

    const withDefault = await releaseLostWorkflowDispatches(RTX_ENV, fetchImpl);
    expect(withDefault).toMatchObject({
      released: [],
      skipped: [{ runId: run.id, reason: "heartbeat_recent" }],
    });
    expect(getWorkflowRun(run.id)?.status).toBe("running");

    const withShortTimeout = await releaseLostWorkflowDispatches(
      { ...RTX_ENV, WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS: String(2 * 60 * 1000) },
      fetchImpl,
    );
    expect(withShortTimeout.released).toEqual([run.id]);
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toMatchObject({
      errorCode: "dispatch_lost",
      livenessTimeoutMs: 2 * 60 * 1000,
    });
  });

  it("counts a recent workflow step as a heartbeat", async () => {
    const contact = createContact({ name: "Reporting Progress" });
    const run = acceptedResearchRun(contact.id, 40);
    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: 0,
      stepType: "tool_call",
      status: "completed",
      tool: "enrich_contact",
      durationMs: 0,
    });

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, sessionsFetch([]));

    expect(sweep.released).toEqual([]);
    expect(getWorkflowRun(run.id)?.status).toBe("running");
  });

  it("keeps a quiet run whose own terminal session is still busy on it", async () => {
    const contact = createContact({ name: "Slow But Alive" });
    const run = acceptedResearchRun(contact.id, 20, "cli-agent:busy");
    const fetchImpl = sessionsFetch([
      {
        id: "cli-agent:busy",
        status: "running",
        workspaceSlug: "signals",
        threadSlug: "contact-enrich-profile",
        chatLinkedTurnStateKnown: true,
        chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
      },
    ]);

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, fetchImpl);

    expect(sweep.skipped).toEqual([{ runId: run.id, reason: "terminal_busy" }]);
    expect(getWorkflowRun(run.id)?.status).toBe("running");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("threadSlug=contact-enrich-profile");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("does not credit a busy shared session to an older run that a newer run replaced", async () => {
    const lost = acceptedResearchRun(createContact({ name: "Older" }).id, 30, "cli-agent:shared");
    const newer = acceptedResearchRun(createContact({ name: "Newer" }).id, 18, "cli-agent:shared");
    const fetchImpl = sessionsFetch([
      {
        id: "cli-agent:shared",
        status: "running",
        chatLinkedTurnStateKnown: true,
        chatLinkedPendingTurn: { id: "turn-newer", state: "dispatched" },
      },
    ]);

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, fetchImpl);

    expect(sweep.released).toEqual([lost.id]);
    expect(sweep.skipped).toEqual([{ runId: newer.id, reason: "terminal_busy" }]);
    // One read per thread, shared between the two runs.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores non-research workflows; the 4-hour cap still owns them", async () => {
    const at = minutesAgoSec(60);
    const snowball = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      startedAt: at,
      config: JSON.stringify({
        ...buildNetworkSnowballTemplateConfig(),
        rtxRuntimeSessionId: "cli-agent:snowball",
      }),
    });
    backdate(snowball.id, { createdAt: at, updatedAt: at });

    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, sessionsFetch([]));

    expect(sweep).toMatchObject({ scanned: 0, released: [] });
    expect(getWorkflowRun(snowball.id)?.status).toBe("running");
  });

  describe("when RTX cannot list the thread's sessions (PR #574 review)", () => {
    const failingListings: Array<[string, () => typeof fetch]> = [
      [
        "an HTTP 503",
        () =>
          vi.fn(async () =>
            new Response(JSON.stringify({ success: false, error: "unavailable" }), { status: 503 }),
          ) as unknown as typeof fetch,
      ],
      [
        "a relay error",
        () =>
          vi.fn(async () =>
            new Response(JSON.stringify({ success: true, runtimeRelayError: true }), { status: 200 }),
          ) as unknown as typeof fetch,
      ],
      [
        "a network error",
        () =>
          vi.fn(async () => {
            throw new TypeError("fetch failed");
          }) as unknown as typeof fetch,
      ],
    ];

    it.each(failingListings)(
      "holds an expired run on %s instead of failing it as dispatch_lost",
      async (_label, makeFetch) => {
        const contact = createContact({ name: "RTX Briefly Down" });
        const run = acceptedResearchRun(contact.id, 20);

        const sweep = await releaseLostWorkflowDispatches(RTX_ENV, makeFetch());
        const single = await releaseLostWorkflowDispatch(run.id, RTX_ENV, makeFetch());

        expect(sweep.released).toEqual([]);
        expect(sweep.skipped).toEqual([
          { runId: run.id, reason: "terminal_inspection_unavailable" },
        ]);
        expect(single).toMatchObject({
          released: false,
          reason: "terminal_inspection_unavailable",
        });
        expect(getWorkflowRun(run.id)?.status).toBe("running");
        expect(listWorkflowSteps(run.id)).toEqual([]);
        expect(getContactWebResearchState(contact.id).status).toBe("pending");
      },
    );

    it("still releases the run once the overall terminal-run timeout has passed", async () => {
      const contact = createContact({ name: "RTX Down For Hours" });
      const run = acceptedResearchRun(contact.id, 4 * 60 + 5);

      const sweep = await releaseLostWorkflowDispatches(RTX_ENV, failingListings[0][1]());

      expect(sweep.released).toEqual([run.id]);
      expect(getContactWebResearchState(contact.id)).toMatchObject({
        status: "failed",
        errorCode: "dispatch_lost",
      });
    });

    it("still releases the run when Signals has no RTX API to ask", async () => {
      const contact = createContact({ name: "Not Embedded" });
      const run = acceptedResearchRun(contact.id, 20);
      const fetchImpl = sessionsFetch([]);

      const sweep = await releaseLostWorkflowDispatches({}, fetchImpl);

      expect(sweep.released).toEqual([run.id]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("gives up on a hung listing at the deadline, so cleanup replay still runs", async () => {
      const contact = createContact({ name: "RTX Hangs" });
      const run = acceptedResearchRun(contact.id, 20);
      const signals: AbortSignal[] = [];
      // Never settles, and ignores the abort signal, like a wedged relay.
      const hung = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => {});
      }) as unknown as typeof fetch;
      const env = { ...RTX_ENV, WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_MS: "25" };
      const order: string[] = [];

      await runWorkflowTerminalMaintenancePass({
        releaseLostDispatches: async () => {
          const sweep = await releaseLostWorkflowDispatches(env, hung);
          order.push(`dispatch-liveness:${sweep.skipped.map((entry) => entry.reason).join(",")}`);
        },
        reconcileCleanups: async () => {
          order.push("cleanup");
        },
      });

      expect(order).toEqual(["dispatch-liveness:terminal_inspection_unavailable", "cleanup"]);
      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(true);
      expect(getWorkflowRun(run.id)?.status).toBe("running");
    });
  });

  it("runs in the always-on maintenance pass, before cleanup replay, even when it throws", async () => {
    const order: string[] = [];
    await runWorkflowTerminalMaintenancePass({
      releaseLostDispatches: async () => {
        order.push("dispatch-liveness");
        throw new Error("sweep failed");
      },
      reconcileCleanups: async () => {
        order.push("cleanup");
      },
    });
    expect(order).toEqual(["dispatch-liveness", "cleanup"]);
  });

  // The pass is started from instrumentation independently of the scheduler; that wiring is pinned
  // by src/instrumentation-entry.test.ts. This test covers the pass's own default sweep, offline:
  // the default reads process.env and the global fetch, so both point at a local stub.
  it("fails lost dispatches from the default maintenance pass", async () => {
    const contact = createContact({ name: "Swept" });
    const run = acceptedResearchRun(contact.id, 20);
    const fetchImpl = sessionsFetch([]);
    vi.stubEnv("RTX_APP_ID", RTX_ENV.RTX_APP_ID);
    vi.stubEnv("RTX_API_BASE_URL", RTX_ENV.RTX_API_BASE_URL);
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await runWorkflowTerminalMaintenancePass({ reconcileCleanups: async () => undefined });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`${RTX_ENV.RTX_API_BASE_URL}/cli/list-terminal-sessions`),
      expect.anything(),
    );
    expect(getWorkflowRun(run.id)?.status).toBe("failed");
    expect(getContactWebResearchState(contact.id).errorCode).toBe("dispatch_lost");
  });

  it("never overwrites a completion that landed after the watchdog read the run", () => {
    const contact = createContact({ name: "Completed In Time" });
    const run = acceptedResearchRun(contact.id, 20);
    db.update(workflowRuns)
      .set({ status: "completed", updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(workflowRuns.id, run.id))
      .run();

    expect(
      failActiveWorkflowRunIfUnchanged(run.id, run.updatedAt, {
        completedAt: 1,
        errors: "[]",
        result: "{}",
      }),
    ).toBeUndefined();
    expect(getWorkflowRun(run.id)?.status).toBe("completed");
  });

  it("releases the run's research lease", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/current",
      handle: "/in/current",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    const lease = acquireSessionLease(connection.id, {
      holder: "contact-web-research:lost",
      targetId: target.id,
      intent: "browse",
      ttlSeconds: 1800,
    });
    const contact = createContact({ name: "Holding A Lease" });
    const run = acceptedResearchRun(contact.id, 20, "cli-agent:lease", {
      researchTarget: {
        targetId: target.id,
        platform: "linkedin",
        source: "default",
        sessionName: "signals-publish",
        startUrl: "https://www.linkedin.com/in/current",
        expectedHandle: "/in/current",
        verifiedHandle: "/in/current",
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: minutesAgoSec(20),
      },
    });

    await expect(releaseLostWorkflowDispatch(run.id, RTX_ENV, sessionsFetch([]))).resolves
      .toMatchObject({ released: true });
    expect(getSessionLeaseById(lease.leaseId)).toBeUndefined();
  });

  it("reports why a single run was not released", async () => {
    const contact = createContact({ name: "Recent" });
    const recent = acceptedResearchRun(contact.id, 1);
    await expect(releaseLostWorkflowDispatch(recent.id, RTX_ENV, sessionsFetch([]))).resolves
      .toMatchObject({ released: false, reason: "heartbeat_recent" });
    await expect(releaseLostWorkflowDispatch("missing", RTX_ENV)).resolves.toMatchObject({
      released: false,
      reason: "not_found",
    });
  });
});
