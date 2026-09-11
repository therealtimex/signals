import {
  getWorkflowRun,
  listWorkflowRunsPendingTerminalCleanup,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import type { WorkflowRun } from "@/lib/db/types";
import { and, eq } from "drizzle-orm";
import type { EnvLike } from "@/lib/rtx/env";
import {
  inspectTerminalRuntimeSessions,
  isTerminalRuntimeSessionBusy,
  terminateTerminalRuntimeSession,
  type TerminalRuntimeSessionSnapshot,
} from "@/lib/rtx/runtime-sessions";
import {
  parseWorkflowRunConfig,
  readWorkflowTerminalLifecycle,
  requestWorkflowTerminalCleanupState as requestLifecycleCleanup,
  writeWorkflowTerminalLifecycle,
  type WorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";

const CLEANUP_LEASE_MS = 60_000;
const CLEANUP_RETRY_DELAYS_MS = [5_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000];
const TERMINAL_WORKFLOW_STATUSES = new Set(["completed", "failed", "cancelled"]);

export type WorkflowTerminalCleanupOutcome = {
  runId: string;
  released: boolean;
  reason: string;
};

function updateLifecycle(
  runId: string,
  mutate: (lifecycle: WorkflowTerminalLifecycle) => WorkflowTerminalLifecycle,
): WorkflowRun | undefined {
  const run = getWorkflowRun(runId);
  const lifecycle = readWorkflowTerminalLifecycle(run?.config);
  if (!run || !lifecycle) return undefined;
  return updateWorkflowRun(runId, {
    config: writeWorkflowTerminalLifecycle(run.config, mutate(lifecycle)),
  });
}

function scheduleCleanupRetry(
  runId: string,
  reason: string,
  now: number,
): WorkflowTerminalCleanupOutcome {
  updateLifecycle(runId, (lifecycle) => {
    const delay =
      CLEANUP_RETRY_DELAYS_MS[
        Math.min(Math.max(lifecycle.cleanup.attempt - 1, 0), CLEANUP_RETRY_DELAYS_MS.length - 1)
      ];
    return {
      ...lifecycle,
      cleanup: {
        ...lifecycle.cleanup,
        state: "retry",
        leaseUntil: undefined,
        nextAttemptAt: now + delay,
        lastError: reason,
      },
    };
  });
  return { runId, released: false, reason };
}

function markCleanupReleased(
  runId: string,
  now: number,
): WorkflowTerminalCleanupOutcome {
  updateLifecycle(runId, (lifecycle) => ({
    ...lifecycle,
    cleanup: {
      ...lifecycle.cleanup,
      state: "released",
      leaseUntil: undefined,
      nextAttemptAt: undefined,
      lastError: undefined,
      releasedAt: now,
    },
  }));
  return { runId, released: true, reason: "released" };
}

function claimCleanup(runId: string, now: number): WorkflowRun | undefined {
  const run = getWorkflowRun(runId);
  const lifecycle = readWorkflowTerminalLifecycle(run?.config);
  if (
    !run ||
    !lifecycle?.cleanup.requested ||
    lifecycle.cleanup.state === "released" ||
    (lifecycle.cleanup.nextAttemptAt ?? 0) > now ||
    (lifecycle.cleanup.leaseUntil ?? 0) > now
  ) {
    return undefined;
  }
  if (typeof run.config !== "string") return undefined;
  const claimedConfig = writeWorkflowTerminalLifecycle(run.config, {
    ...lifecycle,
    cleanup: {
      ...lifecycle.cleanup,
      state: "leased",
      attempt: lifecycle.cleanup.attempt + 1,
      leaseUntil: now + CLEANUP_LEASE_MS,
    },
  });
  const claimed = db
    .update(workflowRuns)
    .set({ config: claimedConfig, updatedAt: Math.floor(now / 1_000) })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.config, run.config)))
    .run();
  if (claimed.changes !== 1) return undefined;
  return getWorkflowRun(runId);
}

function matchingSessions(
  lifecycle: WorkflowTerminalLifecycle,
  sessions: TerminalRuntimeSessionSnapshot[],
): TerminalRuntimeSessionSnapshot[] {
  const routing = lifecycle.dispatch.routing;
  const expectedAliases = new Set(lifecycle.dispatch.session?.aliases ?? []);
  return sessions.filter((session) => {
    if (
      session.workspaceSlug !== routing.workspaceSlug ||
      session.threadSlug !== routing.threadSlug
    ) {
      return false;
    }
    if (expectedAliases.size > 0) {
      return (session.aliases ?? [session.id]).some((alias) =>
        expectedAliases.has(alias),
      );
    }
    const sourcePrompt = session.sourcePrompt ?? "";
    return (
      sourcePrompt.includes(routing.runId) && sourcePrompt.includes(routing.briefPath)
    );
  });
}

async function reconcileClaimedRun(
  run: WorkflowRun,
  now: number,
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<WorkflowTerminalCleanupOutcome> {
  const lifecycle = readWorkflowTerminalLifecycle(run.config);
  if (!lifecycle) {
    return { runId: run.id, released: false, reason: "invalid_lifecycle" };
  }
  if (!TERMINAL_WORKFLOW_STATUSES.has(run.status)) {
    return scheduleCleanupRetry(run.id, "workflow_not_terminal", now);
  }

  const routing = lifecycle.dispatch.routing;
  const inspection = await inspectTerminalRuntimeSessions(
    {
      workspaceSlug: routing.workspaceSlug,
      threadSlug: routing.threadSlug,
      includeClosed: false,
    },
    env,
    fetchImpl,
  );
  if (!inspection.available) {
    return scheduleCleanupRetry(
      run.id,
      `host_list_unavailable:${inspection.error ?? "unknown"}`,
      now,
    );
  }
  if (inspection.guardedTerminationVersion !== 1) {
    return scheduleCleanupRetry(run.id, "host_guard_unavailable", now);
  }

  const matches = matchingSessions(lifecycle, inspection.sessions);
  if (matches.length === 0) return markCleanupReleased(run.id, now);
  if (matches.length > 1) {
    return scheduleCleanupRetry(run.id, "ambiguous_runtime_session", now);
  }

  const session = matches[0];
  if (
    session.chatLinkedTurnStateKnown !== true ||
    isTerminalRuntimeSessionBusy(session)
  ) {
    return scheduleCleanupRetry(run.id, "terminal_session_busy", now);
  }

  const terminated = await terminateTerminalRuntimeSession(
    session.id,
    env,
    fetchImpl,
    {
      reason: lifecycle.cleanup.reason,
      guard: {
        version: 1,
        workspaceSlug: routing.workspaceSlug,
        threadSlug: routing.threadSlug,
        expectedAliases: session.aliases ?? [session.id],
        expectedTurn: {
          known: true,
          id: session.chatLinkedPendingTurn?.id?.trim() || null,
          state: session.chatLinkedPendingTurn?.state?.trim().toLowerCase() || null,
        },
      },
    },
  );
  if (!terminated.success) {
    return scheduleCleanupRetry(
      run.id,
      `terminate_failed:${terminated.code ?? terminated.error}`,
      now,
    );
  }

  const verification = await inspectTerminalRuntimeSessions(
    {
      workspaceSlug: routing.workspaceSlug,
      threadSlug: routing.threadSlug,
      includeClosed: false,
    },
    env,
    fetchImpl,
  );
  if (!verification.available) {
    return scheduleCleanupRetry(run.id, "termination_verification_unavailable", now);
  }
  const remainingAliases = new Set(session.aliases ?? [session.id]);
  if (
    verification.sessions.some((candidate) =>
      (candidate.aliases ?? [candidate.id]).some((alias) =>
        remainingAliases.has(alias),
      ),
    )
  ) {
    return scheduleCleanupRetry(run.id, "terminal_session_still_present", now);
  }
  return markCleanupReleased(run.id, now);
}

export function requestWorkflowTerminalCleanup(
  runId: string,
  reason = "workflow_completed_resumable",
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): { scheduled: boolean; sessionId: string | null } {
  const run = getWorkflowRun(runId);
  if (!run) return { scheduled: false, sessionId: null };
  const config = parseWorkflowRunConfig(run.config);
  const legacySessionId =
    typeof config.rtxRuntimeSessionId === "string"
      ? config.rtxRuntimeSessionId.trim()
      : "";
  const legacyWorkspaceSlug =
    typeof config.rtxWorkspaceSlug === "string" ? config.rtxWorkspaceSlug.trim() : "";
  const legacyThreadSlug =
    typeof config.rtxThreadSlug === "string" ? config.rtxThreadSlug.trim() : "";
  const lifecycle =
    readWorkflowTerminalLifecycle(config) ??
    (legacySessionId && legacyWorkspaceSlug && legacyThreadSlug
      ? ({
          version: 1,
          dispatch: {
            generation: 1,
            attempt: 1,
            state: "accepted",
            startedAt: (run.startedAt ?? run.createdAt) * 1_000,
            settledAt: (run.updatedAt ?? run.createdAt) * 1_000,
            routing: {
              runId,
              workspaceSlug: legacyWorkspaceSlug,
              threadSlug: legacyThreadSlug,
              briefPath: "",
              message: "",
            },
            session: { id: legacySessionId, aliases: [legacySessionId] },
          },
          cleanup: {
            requested: false,
            state: "not_requested",
            reason,
            attempt: 0,
          },
        } satisfies WorkflowTerminalLifecycle)
      : null);
  if (!lifecycle) return { scheduled: false, sessionId: null };

  const requested = requestLifecycleCleanup(lifecycle, reason, Date.now());
  updateWorkflowRun(runId, {
    config: writeWorkflowTerminalLifecycle(run.config, requested),
  });
  if (
    process.env.VITEST_WORKER_ID === undefined &&
    process.env.VITEST_POOL_ID === undefined
  ) {
    setImmediate(() => {
      void reconcileWorkflowTerminalCleanups({ runIds: [runId], env, fetchImpl });
    });
  }
  return {
    scheduled: true,
    sessionId: lifecycle.dispatch.session?.id ?? (legacySessionId || null),
  };
}

export async function reconcileWorkflowTerminalCleanups(
  options: {
    runIds?: string[];
    limit?: number;
    now?: number;
    env?: EnvLike;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ scanned: number; outcomes: WorkflowTerminalCleanupOutcome[] }> {
  const now = options.now ?? Date.now();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = options.runIds?.length
    ? options.runIds
        .slice(0, 25)
        .flatMap((id) => {
          const run = getWorkflowRun(id);
          return run ? [run] : [];
        })
    : listWorkflowRunsPendingTerminalCleanup(now, options.limit ?? 25);
  const queue = [...candidates];
  const outcomes: WorkflowTerminalCleanupOutcome[] = [];

  const worker = async () => {
    for (;;) {
      const candidate = queue.shift();
      if (!candidate) return;
      const claimed = claimCleanup(candidate.id, now);
      if (!claimed) continue;
      outcomes.push(await reconcileClaimedRun(claimed, now, env, fetchImpl));
    }
  };
  await Promise.all([worker(), worker()]);
  return { scanned: candidates.length, outcomes };
}
