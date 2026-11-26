import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { handleCompleteWorkflowRun } from "@/lib/agent-tools/handlers";
import { createContact } from "@/lib/db/queries/contacts";
import {
  claimTemplateThreadSlug,
  getSystemTemplateByName,
} from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME, seedTemplates } from "@/lib/db/seed-templates";
import { getContactWebResearchState } from "@/lib/contacts/web-research-state";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import { assessTemplateThreadLiveness } from "@/lib/rtx/template-thread-liveness";
import {
  releaseLostWorkflowDispatches,
  releaseTimedOutWorkflowTerminalRun,
} from "@/lib/rtx/workflow-run-terminal-watchdog";
import {
  DISPATCH_LOST_SUMMARY,
  TERMINAL_RUN_TIMEOUT_SUMMARY,
  WATCHDOG_RELEASE_OVERRULED_RESULT_KEY,
  clearWatchdogFailureMarkers,
  withoutWatchdogErrors,
} from "@/lib/rtx/workflow-run-watchdog-markers";
import {
  beginWorkflowTerminalDispatch,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import * as workflowEvents from "@/lib/webhooks/workflow-events";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { resetCoreTables } from "@/test/db";

/**
 * #572 round 2: a run the watchdog failed (as `dispatch_lost`, or by the 4 h cap) whose agent then
 * reports back with `complete_workflow_run` must read as completed everywhere. Neither the
 * shared-thread liveness check nor the contact's research state may still see a failure.
 */

const RTX_ENV = { RTX_APP_ID: "signals", RTX_API_BASE_URL: "http://127.0.0.1:3001" };
const SHARED_THREAD = "contact-enrich-profile";

/** A complete, clean research result: no contract gaps, nothing blocked, nothing unresolved. */
const CLEAN_RESEARCH_RESULT = {
  verifiedProfileUrls: [],
  profileSectionsInspected: [],
  emailsObserved: 0,
  experiencesUpserted: 0,
  fieldsUpdated: ["headline"],
};

const minutesAgoSec = (minutes: number) => Math.floor(Date.now() / 1000) - minutes * 60;

/** No RTX call is expected; fail loudly if one is made. */
const noRtx = vi.fn(async () => {
  throw new Error("unexpected RTX call");
}) as unknown as typeof fetch;

const idleThreadFetch = vi.fn(async (input: RequestInfo | URL) =>
  String(input).includes("/cli/list-terminal-sessions")
    ? new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 })
    : new Response(JSON.stringify({ success: false }), { status: 500 }),
) as unknown as typeof fetch;

describe("complete_workflow_run after a watchdog release (#572)", () => {
  let templateId: string;

  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    seedTemplates();
    templateId = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!.id;
    claimTemplateThreadSlug(templateId, null, SHARED_THREAD);
    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue({
      emitted: false,
    } as Awaited<ReturnType<typeof workflowEvents.emitWorkflowCompletedEvent>>);
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
  });

  /** A research run accepted into the shared thread `minutes` ago, then silent. */
  function acceptedResearchRun(contactId: string, minutes: number) {
    const at = minutesAgoSec(minutes);
    const sessionId = `cli-agent:${contactId}`;
    const baseConfig = {
      ...buildContactWebResearchTemplateConfig(),
      contactId,
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: SHARED_THREAD,
      rtxRuntimeSessionId: sessionId,
    };
    const lifecycle = settleWorkflowTerminalDispatch(
      beginWorkflowTerminalDispatch(
        "{}",
        {
          runId: "run",
          workspaceSlug: "signals",
          threadSlug: SHARED_THREAD,
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
    db.update(workflowRuns)
      .set({ createdAt: at, updatedAt: at })
      .where(eq(workflowRuns.id, run.id))
      .run();
    return getWorkflowRun(run.id)!;
  }

  const assessSharedThread = () =>
    assessTemplateThreadLiveness(
      { templateId, workspaceSlug: "signals", threadSlug: SHARED_THREAD },
      RTX_ENV,
      noRtx,
    );

  async function lostThenCompleted() {
    const contact = createContact({ name: "Late Reporter" });
    const run = acceptedResearchRun(contact.id, 20);
    const sweep = await releaseLostWorkflowDispatches(RTX_ENV, idleThreadFetch);
    expect(sweep.released).toEqual([run.id]);

    // Preconditions: the false positive is visible in both readers before the agent reports back.
    expect(getContactWebResearchState(contact.id)).toMatchObject({
      status: "failed",
      errorCode: "dispatch_lost",
    });
    await expect(assessSharedThread()).resolves.toMatchObject({
      alive: false,
      reason: "previous_dispatch_lost",
      previousRunId: run.id,
    });

    const completion = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Researched after all",
      result: CLEAN_RESEARCH_RESULT,
    });
    expect(completion.success).toBe(true);
    return { contact, run };
  }

  it("lets the shared thread stay in use once the lost run reports back", async () => {
    const { run } = await lostThenCompleted();

    await expect(assessSharedThread()).resolves.toEqual({
      alive: true,
      inspectedSessions: false,
    });
    expect(getWorkflowRun(run.id)?.status).toBe("completed");
  });

  it("shows the contact's research as completed, with no dispatch_lost text", async () => {
    const { contact, run } = await lostThenCompleted();

    const state = getContactWebResearchState(contact.id);
    expect(state).toMatchObject({
      status: "succeeded",
      workflowRunId: run.id,
      errorCode: null,
      fieldsUpdated: ["headline"],
    });
    expect(state.message ?? "").not.toContain("dispatch_lost");

    const stored = getWorkflowRun(run.id)!;
    expect(stored.errors).not.toContain("dispatch_lost");
    const result = JSON.parse(stored.result ?? "{}") as Record<string, unknown>;
    expect(result).not.toHaveProperty("errorCode");
    expect(result).not.toHaveProperty("dispatchLost");
    expect(result).not.toHaveProperty("timedOut");
    expect(result).not.toHaveProperty("lastHeartbeatAt");
    expect(result).not.toHaveProperty("livenessTimeoutMs");
    expect(result.summary).toBe("Researched after all");
    // The release is still on record for audit, under a key neither reader interprets.
    expect(result[WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]).toMatchObject({
      code: "dispatch_lost",
      lastHeartbeatAt: expect.any(Number),
      livenessTimeoutMs: 15 * 60 * 1000,
      overruledAt: expect.any(Number),
    });
  });

  it("does the same for a run the 4-hour terminal timeout released", async () => {
    const contact = createContact({ name: "Very Late Reporter" });
    const run = acceptedResearchRun(contact.id, 8 * 60);
    await expect(releaseTimedOutWorkflowTerminalRun(run.id, RTX_ENV, idleThreadFetch)).resolves
      .toMatchObject({ released: true });
    await expect(assessSharedThread()).resolves.toMatchObject({
      alive: false,
      reason: "previous_dispatch_lost",
    });

    await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      result: CLEAN_RESEARCH_RESULT,
    });

    await expect(assessSharedThread()).resolves.toMatchObject({ alive: true });
    expect(getContactWebResearchState(contact.id)).toMatchObject({
      status: "succeeded",
      errorCode: null,
    });
    const result = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
    expect(result).not.toHaveProperty("timedOut");
    expect(result).not.toHaveProperty("summary");
    expect(result[WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]).toMatchObject({
      code: "terminal_run_timeout",
    });
  });

  it("keeps the audit key server-owned", async () => {
    const contact = createContact({ name: "Ordinary Run" });
    const run = acceptedResearchRun(contact.id, 2);

    await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      result: {
        ...CLEAN_RESEARCH_RESULT,
        [WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]: { code: "forged" },
      },
    });

    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).not.toHaveProperty(
      WATCHDOG_RELEASE_OVERRULED_RESULT_KEY,
    );
  });

  describe("a completion that itself carries watchdog markers (PR #574 review W6)", () => {
    const FORGED_MARKERS = {
      errorCode: "dispatch_lost",
      dispatchLost: true,
      timedOut: true,
      lastHeartbeatAt: 1,
      livenessTimeoutMs: 1,
    };

    it("cannot put them back after overruling a dispatch_lost release", async () => {
      const contact = createContact({ name: "Late Reporter With Markers" });
      const run = acceptedResearchRun(contact.id, 20);
      await releaseLostWorkflowDispatches(RTX_ENV, idleThreadFetch);

      await handleCompleteWorkflowRun({
        runId: run.id,
        status: "completed",
        result: { ...CLEAN_RESEARCH_RESULT, ...FORGED_MARKERS },
      });

      await expect(assessSharedThread()).resolves.toEqual({
        alive: true,
        inspectedSessions: false,
      });
      expect(getContactWebResearchState(contact.id)).toMatchObject({
        status: "succeeded",
        errorCode: null,
      });
      const result = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
      for (const key of Object.keys(FORGED_MARKERS)) expect(result).not.toHaveProperty(key);
      expect(result[WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]).toMatchObject({ code: "dispatch_lost" });
    });

    it("cannot mark the shared thread lost from a run the watchdog never touched", async () => {
      const contact = createContact({ name: "Ordinary Run With Markers" });
      const run = acceptedResearchRun(contact.id, 2);

      await handleCompleteWorkflowRun({
        runId: run.id,
        status: "failed",
        result: { ...CLEAN_RESEARCH_RESULT, ...FORGED_MARKERS },
      });

      await expect(assessSharedThread()).resolves.toMatchObject({ alive: true });
      const result = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
      for (const key of Object.keys(FORGED_MARKERS)) expect(result).not.toHaveProperty(key);
    });

    it("keeps an error code that is the agent's own", async () => {
      const contact = createContact({ name: "Agent Error Code" });
      const run = acceptedResearchRun(contact.id, 2);

      await handleCompleteWorkflowRun({
        runId: run.id,
        status: "failed",
        result: { ...CLEAN_RESEARCH_RESULT, errorCode: "auth_state_lost" },
      });

      expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toMatchObject({
        errorCode: "auth_state_lost",
      });
    });
  });
});

describe("watchdog marker helpers", () => {
  it("leaves a result the watchdog never touched exactly as it was", () => {
    const result = { errorCode: "launch_failed", message: "relay error" };
    expect(clearWatchdogFailureMarkers(result, 1)).toBe(result);
  });

  it("keeps a summary or message that the watchdog did not write", () => {
    expect(
      clearWatchdogFailureMarkers(
        { timedOut: true, summary: "agent's own summary", message: DISPATCH_LOST_SUMMARY },
        7,
      ),
    ).toEqual({
      summary: "agent's own summary",
      [WATCHDOG_RELEASE_OVERRULED_RESULT_KEY]: { code: "terminal_run_timeout", overruledAt: 7 },
    });
  });

  it("drops only the watchdog's own error entries", () => {
    expect(
      withoutWatchdogErrors([DISPATCH_LOST_SUMMARY, "source_blocked:x", TERMINAL_RUN_TIMEOUT_SUMMARY]),
    ).toEqual(["source_blocked:x"]);
  });
});
