import {
  getRtxRuntimeSessionIdFromRunConfig,
} from "@/lib/agents/run-template-via-rtx";
import {
  getWorkflowRun,
  listRunningTerminalAgentWorkflowRuns,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import type { WorkflowRun } from "@/lib/db/types";
import type { EnvLike } from "@/lib/rtx/env";
import {
  finalizeChatLinkedTerminalSession,
  formatDeferredTerminalTeardownNote,
} from "@/lib/rtx/resource-teardown";
import { postWorkflowCompletionThreadMessage } from "@/lib/rtx/workflow-completion-thread";
import { releaseContactWebResearchTargetFromRunConfig } from "@/lib/workflows/contact-web-research-target";

export const DEFAULT_WORKFLOW_TERMINAL_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const WORKFLOW_TERMINAL_RUN_TIMEOUT_ENV = "WORKFLOW_TERMINAL_RUN_TIMEOUT_MS";

const TIMEOUT_SUMMARY =
  "Workflow timed out waiting for complete_workflow_run. Signals released the linked terminal session.";

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
  if (!runtimeSessionId) {
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

  const [resourceTeardown, completionThreadMessage] = await Promise.all([
    finalizeChatLinkedTerminalSession(
      {
        terminalSessionId: runtimeSessionId,
        stopAllRunningBrowsers: true,
      },
      env,
      fetchImpl,
    ),
    postWorkflowCompletionThreadMessage(updated, {
      status: "failed",
      summary: TIMEOUT_SUMMARY,
    }, env, fetchImpl),
  ]);
  releaseContactWebResearchTargetFromRunConfig(run.config);

  const teardownNote = formatDeferredTerminalTeardownNote({
    terminal: resourceTeardown.terminalSessionTeardown,
    browser: resourceTeardown.browserSessionTeardown,
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
