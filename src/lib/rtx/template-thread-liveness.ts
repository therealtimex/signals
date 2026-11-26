import { listRecentDispatchedTemplateRunsOnThread } from "@/lib/db/queries/workflows";
import type { WorkflowRun } from "@/lib/db/types";
import type { EnvLike } from "@/lib/rtx/env";
import { inspectTerminalRuntimeSessions } from "@/lib/rtx/runtime-sessions";
import {
  parseWorkflowRunConfig,
  readWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";

/**
 * Why a template's shared RTX thread must not receive the next dispatch (#572).
 *
 * - `previous_dispatch_unconfirmed`: the last handoff into the thread was never confirmed by the
 *   terminal (RTX `SEND_MESSAGE_OUTCOME_UNKNOWN`, relay timeout, or a process that died mid-send).
 *   The terminal may still hold that turn, so new turns queue behind it and never run.
 * - `previous_dispatch_failed`: the last handoff was refused by the terminal for a non-configuration
 *   reason (`launch_failed`, relay error).
 * - `previous_dispatch_lost`: the last run that was accepted never reported back and was failed by
 *   the watchdog (`dispatch_lost`, or the overall terminal-run timeout).
 * - `dispatched_session_missing`: a run in this thread is still `running`, but RTX no longer lists
 *   the terminal session that accepted it: the thread's terminal is gone.
 */
export type TemplateThreadDeadReason =
  | "previous_dispatch_unconfirmed"
  | "previous_dispatch_failed"
  | "previous_dispatch_lost"
  | "dispatched_session_missing";

export type TemplateThreadLiveness =
  | { alive: true; inspectedSessions: boolean }
  | {
      alive: false;
      reason: TemplateThreadDeadReason;
      previousRunId: string;
      previousErrorCode: string | null;
      inspectedSessions: boolean;
    };

/** Dispatch failures that a new thread cannot fix; they don't make the thread suspect. */
const CONFIGURATION_DISPATCH_ERROR_CODES = new Set([
  "permission_required",
  "terminal_dispatch_required",
  "standalone",
]);

/** RTX may take a moment to list a session it just accepted a turn on. */
export const DISPATCHED_SESSION_LISTING_GRACE_MS = 2 * 60 * 1000;

function readResultErrorCode(run: Pick<WorkflowRun, "result">): string | null {
  const result = parseWorkflowRunConfig(run.result);
  return typeof result.errorCode === "string" && result.errorCode.trim()
    ? result.errorCode.trim()
    : null;
}

function readSessionAliases(run: Pick<WorkflowRun, "config">): string[] {
  const lifecycle = readWorkflowTerminalLifecycle(run.config);
  const config = parseWorkflowRunConfig(run.config);
  const legacy =
    typeof config.rtxRuntimeSessionId === "string" ? config.rtxRuntimeSessionId.trim() : "";
  return [
    ...(lifecycle?.dispatch.session?.aliases ?? []),
    lifecycle?.dispatch.session?.id ?? "",
    legacy,
  ].flatMap((alias) => (alias.trim() ? [alias.trim()] : []));
}

function reachedDispatch(run: Pick<WorkflowRun, "config">): boolean {
  return Boolean(readWorkflowTerminalLifecycle(run.config)) || readSessionAliases(run).length > 0;
}

/**
 * Judge whether a template's dedicated thread is fit to receive a dispatch, before anything is sent.
 *
 * Signals' own run records decide first; that costs one local query. RTX is asked only when a run
 * in the thread is still `running` on an accepted session, and then only with the read-only
 * `GET /cli/list-terminal-sessions` for that one thread. Nothing is ever sent to the terminal. An
 * unreadable session list keeps the thread, the same as a transient thread-lookup failure does.
 */
export async function assessTemplateThreadLiveness(
  input: {
    templateId: string;
    workspaceSlug: string;
    threadSlug: string;
    /** The run about to be dispatched; it is not evidence about the thread. */
    excludeRunId?: string;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<TemplateThreadLiveness> {
  // Newest handoff first, and only runs that were handed to the thread.
  const runs = listRecentDispatchedTemplateRunsOnThread(input.templateId, input.threadSlug).filter(
    (run) => run.id !== input.excludeRunId,
  );

  const lastDispatched = runs.find(reachedDispatch);
  if (lastDispatched) {
    const lifecycle = readWorkflowTerminalLifecycle(lastDispatched.config);
    const result = parseWorkflowRunConfig(lastDispatched.result);
    const errorCode = readResultErrorCode(lastDispatched);
    const dead = (reason: TemplateThreadDeadReason): TemplateThreadLiveness => ({
      alive: false,
      reason,
      previousRunId: lastDispatched.id,
      previousErrorCode: errorCode,
      inspectedSessions: false,
    });
    if (errorCode === "dispatch_lost" || result.timedOut === true) {
      return dead("previous_dispatch_lost");
    }
    const dispatchState = lifecycle?.dispatch.state;
    if (dispatchState === "uncertain") return dead("previous_dispatch_unconfirmed");
    if (
      dispatchState === "dispatching" &&
      lastDispatched.status !== "pending" &&
      lastDispatched.status !== "running"
    ) {
      return dead("previous_dispatch_unconfirmed");
    }
    if (
      dispatchState === "failed" &&
      !CONFIGURATION_DISPATCH_ERROR_CODES.has(errorCode ?? "")
    ) {
      return dead("previous_dispatch_failed");
    }
  }

  const runningOnSession = runs.filter((run) => {
    if (run.status !== "running") return false;
    const lifecycle = readWorkflowTerminalLifecycle(run.config);
    if (lifecycle && lifecycle.dispatch.state !== "accepted") return false;
    if (readSessionAliases(run).length === 0) return false;
    const acceptedAtMs =
      lifecycle?.dispatch.settledAt ?? lifecycle?.dispatch.startedAt ?? (run.startedAt ?? 0) * 1000;
    return nowMs - acceptedAtMs >= DISPATCHED_SESSION_LISTING_GRACE_MS;
  });
  if (runningOnSession.length === 0) return { alive: true, inspectedSessions: false };

  const inspection = await inspectTerminalRuntimeSessions(
    { workspaceSlug: input.workspaceSlug, threadSlug: input.threadSlug, includeClosed: false },
    env,
    fetchImpl,
  );
  if (!inspection.available) return { alive: true, inspectedSessions: true };

  const listed = new Set(
    inspection.sessions.flatMap((session) => [session.id, ...(session.aliases ?? [])]),
  );
  const orphan = runningOnSession.find(
    (run) => !readSessionAliases(run).some((alias) => listed.has(alias)),
  );
  if (orphan) {
    return {
      alive: false,
      reason: "dispatched_session_missing",
      previousRunId: orphan.id,
      previousErrorCode: readResultErrorCode(orphan),
      inspectedSessions: true,
    };
  }
  return { alive: true, inspectedSessions: true };
}
