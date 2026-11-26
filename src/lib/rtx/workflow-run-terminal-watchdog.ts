import {
  getRtxRuntimeSessionIdFromRunConfig,
} from "@/lib/agents/run-template-via-rtx";
import {
  createWorkflowStep,
  failActiveWorkflowRunIfUnchanged,
  getLatestWorkflowStepCreatedAt,
  getWorkflowRun,
  listActiveContactWebResearchRuns,
  listRunningTerminalAgentWorkflowRuns,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import type { WorkflowRun } from "@/lib/db/types";
import type { EnvLike } from "@/lib/rtx/env";
import {
  formatDeferredTerminalTeardownNote,
  stopRunningRtxBrowserSessions,
} from "@/lib/rtx/resource-teardown";
import {
  inspectTerminalRuntimeSessions,
  isTerminalRuntimeSessionBusy,
  type TerminalRuntimeSessionInspection,
} from "@/lib/rtx/runtime-sessions";
import { requestWorkflowTerminalCleanup } from "@/lib/rtx/workflow-terminal-reconciler";
import {
  parseWorkflowRunConfig,
  readWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { postWorkflowCompletionThreadMessage } from "@/lib/rtx/workflow-completion-thread";
import { releaseContactWebResearchTargetFromRunConfig } from "@/lib/workflows/contact-web-research-target";
import { releaseNetworkSnowballTargetForRun } from "@/lib/workflows/network-snowball-target";
import {
  DISPATCH_LOST_ERROR_CODE,
  DISPATCH_LOST_SUMMARY,
  TERMINAL_RUN_TIMEOUT_SUMMARY,
} from "@/lib/rtx/workflow-run-watchdog-markers";

export const DEFAULT_WORKFLOW_TERMINAL_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const WORKFLOW_TERMINAL_RUN_TIMEOUT_ENV = "WORKFLOW_TERMINAL_RUN_TIMEOUT_MS";

/**
 * Dispatch-liveness window for Contact Web Research (#572). Healthy runs finish in 3–6 minutes;
 * a run with no heartbeat for this long, and no busy terminal of its own, was lost in dispatch.
 */
export const DEFAULT_WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS = 15 * 60 * 1000;
export const WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_ENV = "WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS";
export { DISPATCH_LOST_ERROR_CODE };

/**
 * Deadline for the one RTX session listing the liveness check makes per thread. A listing that
 * hangs counts as unavailable, so the maintenance pass still reaches terminal cleanup and the next
 * interval retries.
 */
export const DEFAULT_WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_MS = 15_000;
export const WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_ENV = "WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_MS";

const TIMEOUT_SUMMARY = TERMINAL_RUN_TIMEOUT_SUMMARY;

export function resolveWorkflowTerminalRunTimeoutMs(env: EnvLike = process.env): number {
  const parsed = Number.parseInt(env[WORKFLOW_TERMINAL_RUN_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WORKFLOW_TERMINAL_RUN_TIMEOUT_MS;
}

export function isWorkflowRunTerminalTimeout(
  run: Pick<WorkflowRun, "status" | "startedAt" | "updatedAt">,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_WORKFLOW_TERMINAL_RUN_TIMEOUT_MS,
): boolean {
  if (run.status !== "running") return false;
  const anchorSec = run.startedAt ?? run.updatedAt;
  if (!anchorSec || anchorSec <= 0) return false;
  return nowMs - anchorSec * 1000 >= timeoutMs;
}

export async function releaseTimedOutWorkflowTerminalRun(
  runId: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  released: boolean;
  runId: string;
  reason?: string;
  message?: string;
}> {
  const run = getWorkflowRun(runId);
  if (!run || run.status !== "running") {
    return { released: false, runId, reason: "not_running" };
  }

  const runtimeSessionId = getRtxRuntimeSessionIdFromRunConfig(run.config)?.trim() || null;
  const terminalLifecycle = readWorkflowTerminalLifecycle(run.config);
  if (!runtimeSessionId && !terminalLifecycle) {
    return { released: false, runId, reason: "no_terminal_session" };
  }

  const timeoutMs = resolveWorkflowTerminalRunTimeoutMs(env);
  if (!isWorkflowRunTerminalTimeout(run, Date.now(), timeoutMs)) {
    return { released: false, runId, reason: "not_timed_out" };
  }

  const completedAt = Math.floor(Date.now() / 1000);
  const updated = updateWorkflowRun(run.id, {
    status: "failed",
    completedAt,
    errors: JSON.stringify([TIMEOUT_SUMMARY]),
    result: JSON.stringify({ summary: TIMEOUT_SUMMARY, timedOut: true }),
  });
  if (!updated || updated.status !== "failed") {
    return { released: false, runId, reason: "update_failed" };
  }

  const terminalSessionTeardown = requestWorkflowTerminalCleanup(
    updated.id,
    "workflow_timed_out_resumable",
    env,
    fetchImpl,
  );
  const [browserSessionTeardown, completionThreadMessage] = await Promise.all([
    stopRunningRtxBrowserSessions({ stopAllRunning: true }, env, fetchImpl),
    postWorkflowCompletionThreadMessage(updated, {
      status: "failed",
      summary: TIMEOUT_SUMMARY,
    }, env, fetchImpl),
  ]);
  releaseContactWebResearchTargetFromRunConfig(run.config);
  releaseNetworkSnowballTargetForRun(run.id);

  const teardownNote = formatDeferredTerminalTeardownNote({
    terminal: terminalSessionTeardown,
    browser: browserSessionTeardown,
  });

  return {
    released: true,
    runId,
    message: [
      TIMEOUT_SUMMARY,
      teardownNote.trim(),
      completionThreadMessage.posted ? "Completion summary posted to thread." : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// ── Dispatch liveness (#572) ──────────────────────────────────────────────

export function resolveWorkflowDispatchLivenessTimeoutMs(env: EnvLike = process.env): number {
  const parsed = Number.parseInt(env[WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS;
}

/**
 * The last moment Signals heard anything about a run, in epoch milliseconds.
 *
 * Heartbeats are the signals Signals already receives, all local:
 * - the run row's `updatedAt` (every Signals-side write: dispatch settle, progress, cohort records);
 * - the newest workflow step recorded for the run (tool calls Signals logs against it);
 * - the terminal lifecycle's dispatch `startedAt`/`settledAt` (when Signals handed it to RTX).
 * `startedAt`/`createdAt` anchor runs that never got further than the row (`pending`).
 */
export function getWorkflowRunHeartbeatAtMs(
  run: Pick<WorkflowRun, "config" | "createdAt" | "startedAt" | "updatedAt">,
  latestStepCreatedAtSec: number | null = null,
): number {
  const lifecycle = readWorkflowTerminalLifecycle(run.config);
  const candidates = [
    run.createdAt,
    run.startedAt,
    run.updatedAt,
    latestStepCreatedAtSec,
  ]
    .filter((value): value is number => typeof value === "number" && value > 0)
    .map((sec) => sec * 1000);
  if (lifecycle) {
    candidates.push(lifecycle.dispatch.startedAt);
    if (typeof lifecycle.dispatch.settledAt === "number") {
      candidates.push(lifecycle.dispatch.settledAt);
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

export function resolveWorkflowDispatchInspectionTimeoutMs(env: EnvLike = process.env): number {
  const parsed = Number.parseInt(env[WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WORKFLOW_DISPATCH_INSPECTION_TIMEOUT_MS;
}

export function isWorkflowRunDispatchLivenessExpired(
  run: Pick<WorkflowRun, "status" | "config" | "createdAt" | "startedAt" | "updatedAt">,
  latestStepCreatedAtSec: number | null,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_WORKFLOW_DISPATCH_LIVENESS_TIMEOUT_MS,
): boolean {
  if (run.status !== "pending" && run.status !== "running") return false;
  const heartbeatMs = getWorkflowRunHeartbeatAtMs(run, latestStepCreatedAtSec);
  if (heartbeatMs <= 0) return false;
  return nowMs - heartbeatMs >= timeoutMs;
}

type RunTerminalRef = {
  workspaceSlug: string;
  threadSlug: string;
  aliases: string[];
  dispatchedAtMs: number;
};

function readRunTerminalRef(run: Pick<WorkflowRun, "config" | "startedAt">): RunTerminalRef | null {
  const lifecycle = readWorkflowTerminalLifecycle(run.config);
  const config = parseWorkflowRunConfig(run.config);
  const legacySessionId =
    typeof config.rtxRuntimeSessionId === "string" ? config.rtxRuntimeSessionId.trim() : "";
  const aliases = [
    ...(lifecycle?.dispatch.session?.aliases ?? []),
    lifecycle?.dispatch.session?.id ?? "",
    legacySessionId,
  ]
    .map((alias) => alias.trim())
    .filter(Boolean);
  const workspaceSlug =
    lifecycle?.dispatch.routing.workspaceSlug ||
    (typeof config.rtxWorkspaceSlug === "string" ? config.rtxWorkspaceSlug : "");
  const threadSlug =
    lifecycle?.dispatch.routing.threadSlug ||
    (typeof config.rtxThreadSlug === "string" ? config.rtxThreadSlug : "");
  if (aliases.length === 0 || !workspaceSlug.trim() || !threadSlug.trim()) return null;
  return {
    workspaceSlug: workspaceSlug.trim(),
    threadSlug: threadSlug.trim(),
    aliases: [...new Set(aliases)],
    dispatchedAtMs: lifecycle?.dispatch.settledAt ?? lifecycle?.dispatch.startedAt ??
      (run.startedAt ?? 0) * 1000,
  };
}

type ThreadInspectionCache = Map<string, Promise<TerminalRuntimeSessionInspection>>;

/** List one thread's sessions, giving up (as unavailable) once the deadline passes. */
async function inspectThreadSessionsWithDeadline(
  ref: RunTerminalRef,
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<TerminalRuntimeSessionInspection> {
  const timeoutMs = resolveWorkflowDispatchInspectionTimeoutMs(env);
  const controller = new AbortController();
  const boundedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, { ...init, signal: controller.signal })) as typeof fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TerminalRuntimeSessionInspection>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({
        available: false,
        sessions: [],
        guardedTerminationVersion: null,
        unavailableReason: "request_failed",
        error: `Listing terminal sessions timed out after ${timeoutMs} ms`,
      });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      inspectTerminalRuntimeSessions(
        { workspaceSlug: ref.workspaceSlug, threadSlug: ref.threadSlug, includeClosed: false },
        env,
        boundedFetch,
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the run's own terminal session is doing — the one RTX-side heartbeat.
 *
 * One read-only `GET /cli/list-terminal-sessions` per thread; nothing is sent to the terminal. A
 * busy session counts for this run only if no newer active run was dispatched into the same
 * session, because a shared thread's session may be busy on someone else's turn.
 *
 * `unknown` when RTX was asked and did not answer (an error, a relay failure, the deadline): a
 * transient outage is not evidence that the terminal is idle. `idle` when Signals has no RTX API
 * at all, since nothing there can be holding the turn.
 */
async function inspectRunTerminalActivity(
  run: WorkflowRun,
  activeRuns: WorkflowRun[],
  cache: ThreadInspectionCache,
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<"busy" | "idle" | "unknown"> {
  const ref = readRunTerminalRef(run);
  if (!ref) return "idle";

  const ownAliases = new Set(ref.aliases);
  const newerOwner = activeRuns.some((other) => {
    if (other.id === run.id) return false;
    const otherRef = readRunTerminalRef(other);
    return Boolean(
      otherRef &&
        otherRef.dispatchedAtMs > ref.dispatchedAtMs &&
        otherRef.aliases.some((alias) => ownAliases.has(alias)),
    );
  });
  if (newerOwner) return "idle";

  const key = `${ref.workspaceSlug}\u0000${ref.threadSlug}`;
  let inspection = cache.get(key);
  if (!inspection) {
    inspection = inspectThreadSessionsWithDeadline(ref, env, fetchImpl);
    cache.set(key, inspection);
  }
  const { available, sessions, unavailableReason } = await inspection;
  if (!available) return unavailableReason === "not_configured" ? "idle" : "unknown";
  const session = sessions.find((candidate) =>
    [candidate.id, ...(candidate.aliases ?? [])].some((alias) => ownAliases.has(alias)),
  );
  return isTerminalRuntimeSessionBusy(session) ? "busy" : "idle";
}

export type LostWorkflowDispatchOutcome = {
  released: boolean;
  runId: string;
  reason?:
    | "not_found"
    | "not_active"
    | "not_contact_research"
    | "heartbeat_recent"
    | "terminal_busy"
    | "terminal_inspection_unavailable"
    | "changed_concurrently";
  message?: string;
};

async function releaseLostWorkflowDispatchFromSnapshot(
  run: WorkflowRun,
  activeRuns: WorkflowRun[],
  cache: ThreadInspectionCache,
  timeoutMs: number,
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<LostWorkflowDispatchOutcome> {
  const latestStepAt = getLatestWorkflowStepCreatedAt(run.id);
  if (!isWorkflowRunDispatchLivenessExpired(run, latestStepAt, Date.now(), timeoutMs)) {
    return { released: false, runId: run.id, reason: "heartbeat_recent" };
  }
  const activity = await inspectRunTerminalActivity(run, activeRuns, cache, env, fetchImpl);
  if (activity === "busy") {
    return { released: false, runId: run.id, reason: "terminal_busy" };
  }
  // RTX could not say whether the terminal is still on this run. Hold it rather than fail a healthy
  // run during an outage; a re-dispatch could not reach RTX either. The overall terminal-run
  // timeout still bounds the hold, so an RTX that never answers again cannot pin the contact.
  if (
    activity === "unknown" &&
    !isWorkflowRunDispatchLivenessExpired(
      run,
      latestStepAt,
      Date.now(),
      Math.max(timeoutMs, resolveWorkflowTerminalRunTimeoutMs(env)),
    )
  ) {
    return { released: false, runId: run.id, reason: "terminal_inspection_unavailable" };
  }

  const lastHeartbeatAt = Math.floor(getWorkflowRunHeartbeatAtMs(run, latestStepAt) / 1000);
  const completedAt = Math.floor(Date.now() / 1000);
  const previousResult = parseWorkflowRunConfig(run.result);
  const updated = failActiveWorkflowRunIfUnchanged(run.id, run.updatedAt, {
    completedAt,
    errors: JSON.stringify([DISPATCH_LOST_SUMMARY]),
    errorItems: 1,
    result: JSON.stringify({
      ...previousResult,
      summary: DISPATCH_LOST_SUMMARY,
      message: DISPATCH_LOST_SUMMARY,
      errorCode: DISPATCH_LOST_ERROR_CODE,
      dispatchLost: true,
      timedOut: true,
      lastHeartbeatAt,
      livenessTimeoutMs: timeoutMs,
    }),
  });
  if (!updated) {
    return { released: false, runId: run.id, reason: "changed_concurrently" };
  }

  createWorkflowStep({
    workflowRunId: run.id,
    stepIndex: nextStepIndex(run.id),
    stepType: "error",
    status: "failed",
    tool: "workflow_dispatch_watchdog",
    error: DISPATCH_LOST_SUMMARY,
    output: JSON.stringify({
      code: DISPATCH_LOST_ERROR_CODE,
      previousStatus: run.status,
      lastHeartbeatAt,
      livenessTimeoutMs: timeoutMs,
    }),
    durationMs: 0,
  });

  // Browser sessions are deliberately left alone: the research target is the shared, signed-in
  // `signals-publish` session, and a lost dispatch never owned it beyond the lease released here.
  const terminalSessionTeardown = requestWorkflowTerminalCleanup(
    updated.id,
    "workflow_dispatch_lost_resumable",
    env,
    fetchImpl,
  );
  releaseContactWebResearchTargetFromRunConfig(run.config);
  const completionThreadMessage = await postWorkflowCompletionThreadMessage(
    updated,
    { status: "failed", summary: DISPATCH_LOST_SUMMARY },
    env,
    fetchImpl,
  ).catch(() => ({ posted: false }));

  return {
    released: true,
    runId: run.id,
    message: [
      DISPATCH_LOST_SUMMARY,
      terminalSessionTeardown.scheduled ? "Terminal session release scheduled." : "",
      completionThreadMessage.posted ? "Completion summary posted to thread." : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Fail one Contact Web Research run as `dispatch_lost` if its dispatch-liveness window expired.
 * Called by the web-research route before it refuses a re-run with `ENRICHMENT_IN_PROGRESS`, so a
 * lost run never blocks its contact even when the scheduler sweep is off.
 */
export async function releaseLostWorkflowDispatch(
  runId: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<LostWorkflowDispatchOutcome> {
  const run = getWorkflowRun(runId);
  if (!run) return { released: false, runId, reason: "not_found" };
  if (run.status !== "pending" && run.status !== "running") {
    return { released: false, runId, reason: "not_active" };
  }
  const activeRuns = listActiveContactWebResearchRuns();
  if (!activeRuns.some((candidate) => candidate.id === runId)) {
    return { released: false, runId, reason: "not_contact_research" };
  }
  return releaseLostWorkflowDispatchFromSnapshot(
    run,
    activeRuns,
    new Map(),
    resolveWorkflowDispatchLivenessTimeoutMs(env),
    env,
    fetchImpl,
  );
}

/**
 * Sweep every unfinished Contact Web Research run for lost dispatches.
 *
 * Driven by the always-on terminal cleanup runner, not the optional scheduler: installed Local
 * Apps run with `SIGNALS_SCHEDULER_ENABLED=0`, where a scheduler-only sweep never runs.
 */
export async function releaseLostWorkflowDispatches(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ scanned: number; released: string[]; skipped: Array<{ runId: string; reason: string }> }> {
  const timeoutMs = resolveWorkflowDispatchLivenessTimeoutMs(env);
  const activeRuns = listActiveContactWebResearchRuns();
  const cache: ThreadInspectionCache = new Map();
  const released: string[] = [];
  const skipped: Array<{ runId: string; reason: string }> = [];
  for (const run of activeRuns) {
    const outcome = await releaseLostWorkflowDispatchFromSnapshot(
      run,
      activeRuns,
      cache,
      timeoutMs,
      env,
      fetchImpl,
    );
    if (outcome.released) released.push(run.id);
    else skipped.push({ runId: run.id, reason: outcome.reason ?? "skipped" });
  }
  return { scanned: activeRuns.length, released, skipped };
}

export async function releaseStaleWorkflowTerminalRuns(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  scanned: number;
  released: string[];
  skipped: Array<{ runId: string; reason: string }>;
}> {
  const timeoutMs = resolveWorkflowTerminalRunTimeoutMs(env);
  const nowMs = Date.now();
  const candidates = listRunningTerminalAgentWorkflowRuns();
  const outcomes = await Promise.all(
    candidates.map(async (run) => {
      if (!isWorkflowRunTerminalTimeout(run, nowMs, timeoutMs)) {
        return { released: false as const, runId: run.id, reason: "not_timed_out" };
      }
      const result = await releaseTimedOutWorkflowTerminalRun(run.id, env, fetchImpl);
      return {
        released: result.released,
        runId: run.id,
        reason: result.reason ?? "skipped",
      };
    }),
  );

  const released: string[] = [];
  const skipped: Array<{ runId: string; reason: string }> = [];
  for (const outcome of outcomes) {
    if (outcome.released) {
      released.push(outcome.runId);
    } else {
      skipped.push({ runId: outcome.runId, reason: outcome.reason });
    }
  }

  return { scanned: candidates.length, released, skipped };
}
