import {
  getWorkflowRun,
  listNonTerminalWorkflowRunsWithTerminalLifecycle,
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
  withTerminalThreadAdmission,
  type TerminalRuntimeSessionSnapshot,
} from "@/lib/rtx/runtime-sessions";
import {
  RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
  RTX_TERMINAL_LIFECYCLE_CONFIG_KEY,
  parseWorkflowRunConfig,
  readWorkflowTerminalLifecycle,
  requestWorkflowTerminalCleanupState as requestLifecycleCleanup,
  writeWorkflowTerminalLifecycle,
  type WorkflowTerminalLifecycleConfigKey,
  type WorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";

const CLEANUP_LEASE_MS = 60_000;
const CLEANUP_RETRY_DELAYS_MS = [5_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000];
const TERMINAL_WORKFLOW_STATUSES = new Set(["completed", "failed", "cancelled"]);
const LIFECYCLE_KEYS: WorkflowTerminalLifecycleConfigKey[] = [
  RTX_TERMINAL_LIFECYCLE_CONFIG_KEY,
  RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
];

export type WorkflowTerminalCleanupOutcome = {
  runId: string;
  released: boolean;
  reason: string;
};

function updateLifecycle(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
  mutate: (lifecycle: WorkflowTerminalLifecycle) => WorkflowTerminalLifecycle,
): WorkflowRun | undefined {
  const run = getWorkflowRun(runId);
  const lifecycle = readWorkflowTerminalLifecycle(run?.config, key);
  if (!run || !lifecycle || typeof run.config !== "string") return undefined;
  const nextConfig = writeWorkflowTerminalLifecycle(
    run.config,
    mutate(lifecycle),
    key,
  );
  const updated = db
    .update(workflowRuns)
    .set({ config: nextConfig })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.config, run.config)))
    .run();
  return updated.changes === 1 ? getWorkflowRun(runId) : undefined;
}

function scheduleCleanupRetry(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
  reason: string,
  now: number,
): WorkflowTerminalCleanupOutcome {
  const updated = updateLifecycle(runId, key, (lifecycle) => {
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
  return updated
    ? { runId, released: false, reason }
    : { runId, released: false, reason: "cleanup_claim_changed" };
}

function markCleanupReleased(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
  now: number,
): WorkflowTerminalCleanupOutcome {
  const updated = updateLifecycle(runId, key, (lifecycle) => ({
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
  return updated
    ? { runId, released: true, reason: "released" }
    : { runId, released: false, reason: "cleanup_claim_changed" };
}

function claimCleanup(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
  now: number,
): WorkflowRun | undefined {
  const run = getWorkflowRun(runId);
  const lifecycle = readWorkflowTerminalLifecycle(run?.config, key);
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
  const claimedConfig = writeWorkflowTerminalLifecycle(
    run.config,
    {
      ...lifecycle,
      cleanup: {
        ...lifecycle.cleanup,
        state: "leased",
        attempt: lifecycle.cleanup.attempt + 1,
        leaseUntil: now + CLEANUP_LEASE_MS,
      },
    },
    key,
  );
  const claimed = db
    .update(workflowRuns)
    .set({ config: claimedConfig })
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
    if (
      expectedAliases.size > 0 &&
      (session.aliases ?? [session.id]).some((alias) => expectedAliases.has(alias))
    ) {
      return true;
    }
    const sourcePrompt = session.sourcePrompt ?? "";
    return (
      sourcePrompt.includes(routing.runId) && sourcePrompt.includes(routing.briefPath)
    );
  });
}

function persistObservedSession(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
  session: TerminalRuntimeSessionSnapshot,
): boolean {
  return Boolean(updateLifecycle(runId, key, (lifecycle) => {
    const previous = lifecycle.dispatch.session;
    const aliases = [
      previous?.id,
      ...(previous?.aliases ?? []),
      session.id,
      ...(session.aliases ?? []),
    ].filter((alias): alias is string => Boolean(alias?.trim()));
    return {
      ...lifecycle,
      dispatch: {
        ...lifecycle.dispatch,
        session: {
          id: session.id,
          aliases: [...new Set(aliases.map((alias) => alias.trim()))],
        },
      },
    };
  }));
}

function hasNonTerminalOwnerInThread(
  runId: string,
  lifecycle: WorkflowTerminalLifecycle,
): boolean {
  const routing = lifecycle.dispatch.routing;
  return listNonTerminalWorkflowRunsWithTerminalLifecycle().some((candidate) => {
    if (candidate.id === runId) return false;
    const lifecycleOwnsThread = LIFECYCLE_KEYS.some((key) => {
      const owner = readWorkflowTerminalLifecycle(candidate.config, key);
      return (
        owner?.dispatch.routing.workspaceSlug === routing.workspaceSlug &&
        owner.dispatch.routing.threadSlug === routing.threadSlug
      );
    });
    if (lifecycleOwnsThread) return true;
    const legacy = parseWorkflowRunConfig(candidate.config);
    return (
      legacy.rtxWorkspaceSlug === routing.workspaceSlug &&
      legacy.rtxThreadSlug === routing.threadSlug
    );
  });
}

function lifecycleCleanupIsDue(
  lifecycle: WorkflowTerminalLifecycle | null,
  now: number,
): lifecycle is WorkflowTerminalLifecycle {
  return Boolean(
    lifecycle?.cleanup.requested &&
      lifecycle.cleanup.state !== "released" &&
      (lifecycle.cleanup.nextAttemptAt ?? 0) <= now &&
      (lifecycle.cleanup.leaseUntil ?? 0) <= now,
  );
}

async function reconcileClaimedRun(
  run: WorkflowRun,
  key: WorkflowTerminalLifecycleConfigKey,
  now: number,
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<WorkflowTerminalCleanupOutcome> {
  const lifecycle = readWorkflowTerminalLifecycle(run.config, key);
  if (!lifecycle) {
    return { runId: run.id, released: false, reason: "invalid_lifecycle" };
  }
  if (!TERMINAL_WORKFLOW_STATUSES.has(run.status)) {
    return scheduleCleanupRetry(run.id, key, "workflow_not_terminal", now);
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
      key,
      `host_list_unavailable:${inspection.error ?? "unknown"}`,
      now,
    );
  }
  if (inspection.guardedTerminationVersion !== 1) {
    return scheduleCleanupRetry(run.id, key, "host_guard_unavailable", now);
  }

  const matches = matchingSessions(lifecycle, inspection.sessions);
  if (matches.length === 0) {
    return lifecycle.dispatch.session
      ? markCleanupReleased(run.id, key, now)
      : scheduleCleanupRetry(run.id, key, "runtime_session_unobserved", now);
  }
  if (matches.length > 1) {
    return scheduleCleanupRetry(run.id, key, "ambiguous_runtime_session", now);
  }

  const session = matches[0];
  if (!persistObservedSession(run.id, key, session)) {
    return { runId: run.id, released: false, reason: "cleanup_claim_changed" };
  }
  if (
    session.chatLinkedTurnStateKnown !== true ||
    isTerminalRuntimeSessionBusy(session)
  ) {
    return scheduleCleanupRetry(run.id, key, "terminal_session_busy", now);
  }

  return withTerminalThreadAdmission(
    routing.workspaceSlug,
    routing.threadSlug,
    async () => {
      const currentRun = getWorkflowRun(run.id);
      const currentLifecycle = readWorkflowTerminalLifecycle(currentRun?.config, key);
      if (
        !currentRun ||
        !currentLifecycle ||
        currentLifecycle.dispatch.generation !== lifecycle.dispatch.generation
      ) {
        return {
          runId: run.id,
          released: false,
          reason: "cleanup_claim_changed",
        };
      }
      if (hasNonTerminalOwnerInThread(run.id, currentLifecycle)) {
        return scheduleCleanupRetry(
          run.id,
          key,
          "runtime_owned_by_nonterminal_workflow",
          now,
        );
      }

      const terminated = await terminateTerminalRuntimeSession(
        session.id,
        env,
        fetchImpl,
        {
          reason: currentLifecycle.cleanup.reason,
          guard: {
            version: 1,
            workspaceSlug: routing.workspaceSlug,
            threadSlug: routing.threadSlug,
            expectedAliases: session.aliases ?? [session.id],
            expectedTurn: {
              known: true,
              id: session.chatLinkedPendingTurn?.id?.trim() || null,
              state:
                session.chatLinkedPendingTurn?.state?.trim().toLowerCase() || null,
            },
          },
        },
      );
      if (!terminated.success) {
        return scheduleCleanupRetry(
          run.id,
          key,
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
        return scheduleCleanupRetry(
          run.id,
          key,
          "termination_verification_unavailable",
          now,
        );
      }
      if (matchingSessions(currentLifecycle, verification.sessions).length > 0) {
        return scheduleCleanupRetry(
          run.id,
          key,
          "terminal_session_still_present",
          now,
        );
      }
      return markCleanupReleased(run.id, key, now);
    },
  );
}

function requestTerminalCleanup(
  runId: string,
  key: WorkflowTerminalLifecycleConfigKey,
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
    readWorkflowTerminalLifecycle(config, key) ??
    (key === RTX_TERMINAL_LIFECYCLE_CONFIG_KEY &&
    legacySessionId &&
    legacyWorkspaceSlug &&
    legacyThreadSlug
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
    config: writeWorkflowTerminalLifecycle(run.config, requested, key),
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

export function requestWorkflowTerminalCleanup(
  runId: string,
  reason = "workflow_completed_resumable",
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): { scheduled: boolean; sessionId: string | null } {
  return requestTerminalCleanup(
    runId,
    RTX_TERMINAL_LIFECYCLE_CONFIG_KEY,
    reason,
    env,
    fetchImpl,
  );
}

export function requestWorkflowOrchestratorTerminalCleanup(
  runId: string,
  reason = "workflow_completed_resumable",
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): { scheduled: boolean; sessionId: string | null } {
  return requestTerminalCleanup(
    runId,
    RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
    reason,
    env,
    fetchImpl,
  );
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
  const queue = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const outcomes: WorkflowTerminalCleanupOutcome[] = [];

  const worker = async () => {
    for (;;) {
      const candidate = queue.shift();
      if (!candidate) return;
      for (const key of LIFECYCLE_KEYS) {
        const current = getWorkflowRun(candidate.id);
        if (
          !current ||
          !lifecycleCleanupIsDue(
            readWorkflowTerminalLifecycle(current.config, key),
            now,
          )
        ) {
          continue;
        }
        const claimed = claimCleanup(candidate.id, key, now);
        if (!claimed) continue;
        outcomes.push(await reconcileClaimedRun(claimed, key, now, env, fetchImpl));
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { scanned: candidates.length, outcomes };
}
