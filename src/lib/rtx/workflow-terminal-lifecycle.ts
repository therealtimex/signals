import type { RuntimeSessionDescriptor } from "@/lib/rtx/runtime-sessions";

export const RTX_TERMINAL_LIFECYCLE_CONFIG_KEY = "rtxTerminalLifecycle";
export const RTX_TERMINAL_LIFECYCLE_VERSION = 1;

export type WorkflowTerminalDispatchState =
  | "dispatching"
  | "accepted"
  | "uncertain"
  | "failed";

export type WorkflowTerminalCleanupState =
  | "not_requested"
  | "pending"
  | "leased"
  | "retry"
  | "released";

export type WorkflowTerminalLifecycle = {
  version: 1;
  dispatch: {
    generation: number;
    attempt: number;
    state: WorkflowTerminalDispatchState;
    startedAt: number;
    settledAt?: number;
    routing: {
      runId: string;
      workspaceSlug: string;
      threadSlug: string;
      briefPath: string;
      message: string;
    };
    session?: {
      id: string;
      aliases: string[];
    };
    lastError?: string;
  };
  cleanup: {
    requested: boolean;
    state: WorkflowTerminalCleanupState;
    reason: string;
    attempt: number;
    requestedAt?: number;
    nextAttemptAt?: number;
    leaseUntil?: number;
    lastError?: string;
    releasedAt?: number;
  };
};

export function parseWorkflowRunConfig(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseWorkflowRunConfig(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readWorkflowTerminalLifecycle(
  config: unknown,
): WorkflowTerminalLifecycle | null {
  const raw = parseWorkflowRunConfig(config)[RTX_TERMINAL_LIFECYCLE_CONFIG_KEY];
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as { version?: unknown }).version !== RTX_TERMINAL_LIFECYCLE_VERSION
  ) {
    return null;
  }

  const lifecycle = raw as Record<string, unknown>;
  const dispatch = lifecycle.dispatch;
  const cleanup = lifecycle.cleanup;
  if (
    !dispatch ||
    typeof dispatch !== "object" ||
    Array.isArray(dispatch) ||
    !cleanup ||
    typeof cleanup !== "object" ||
    Array.isArray(cleanup)
  ) {
    return null;
  }

  const dispatchRecord = dispatch as Record<string, unknown>;
  const cleanupRecord = cleanup as Record<string, unknown>;
  const routing = dispatchRecord.routing;
  const dispatchStates: WorkflowTerminalDispatchState[] = [
    "dispatching",
    "accepted",
    "uncertain",
    "failed",
  ];
  const cleanupStates: WorkflowTerminalCleanupState[] = [
    "not_requested",
    "pending",
    "leased",
    "retry",
    "released",
  ];
  if (
    !routing ||
    typeof routing !== "object" ||
    Array.isArray(routing) ||
    !dispatchStates.includes(
      dispatchRecord.state as WorkflowTerminalDispatchState,
    ) ||
    !cleanupStates.includes(cleanupRecord.state as WorkflowTerminalCleanupState) ||
    typeof dispatchRecord.generation !== "number" ||
    !Number.isFinite(dispatchRecord.generation) ||
    typeof dispatchRecord.attempt !== "number" ||
    !Number.isFinite(dispatchRecord.attempt) ||
    typeof dispatchRecord.startedAt !== "number" ||
    !Number.isFinite(dispatchRecord.startedAt) ||
    typeof cleanupRecord.requested !== "boolean" ||
    typeof cleanupRecord.reason !== "string" ||
    typeof cleanupRecord.attempt !== "number" ||
    !Number.isFinite(cleanupRecord.attempt)
  ) {
    return null;
  }

  const routingRecord = routing as Record<string, unknown>;
  if (
    ["runId", "workspaceSlug", "threadSlug", "briefPath", "message"].some(
      (key) => typeof routingRecord[key] !== "string",
    )
  ) {
    return null;
  }

  const session = dispatchRecord.session;
  const sessionRecord =
    session && typeof session === "object" && !Array.isArray(session)
      ? (session as Record<string, unknown>)
      : null;
  const sessionAliases = sessionRecord?.aliases;
  if (
    session !== undefined &&
    (!sessionRecord ||
      typeof sessionRecord.id !== "string" ||
      !Array.isArray(sessionAliases) ||
      !sessionAliases.every((alias: unknown) => typeof alias === "string"))
  ) {
    return null;
  }
  return raw as WorkflowTerminalLifecycle;
}

export function writeWorkflowTerminalLifecycle(
  config: unknown,
  lifecycle: WorkflowTerminalLifecycle,
): string {
  return JSON.stringify({
    ...parseWorkflowRunConfig(config),
    [RTX_TERMINAL_LIFECYCLE_CONFIG_KEY]: lifecycle,
  });
}

export function stripWorkflowTerminalLifecycle(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const { [RTX_TERMINAL_LIFECYCLE_CONFIG_KEY]: _internal, ...visible } = config;
  return visible;
}

function normalizedAliases(descriptor: RuntimeSessionDescriptor): string[] {
  const aliases: string[] = [];
  for (const value of [descriptor.id, ...(descriptor.aliases ?? [])]) {
    const alias = value.trim();
    if (alias) aliases.push(alias);
  }
  return [...new Set(aliases)];
}

export function beginWorkflowTerminalDispatch(
  config: unknown,
  routing: WorkflowTerminalLifecycle["dispatch"]["routing"],
  now = Date.now(),
): WorkflowTerminalLifecycle {
  const previous = readWorkflowTerminalLifecycle(config);
  return {
    version: RTX_TERMINAL_LIFECYCLE_VERSION,
    dispatch: {
      generation: (previous?.dispatch.generation ?? 0) + 1,
      attempt: (previous?.dispatch.attempt ?? 0) + 1,
      state: "dispatching",
      startedAt: now,
      routing,
    },
    cleanup: {
      requested: true,
      state: "pending",
      reason: "workflow_completed_resumable",
      attempt: 0,
      requestedAt: now,
      nextAttemptAt: now,
    },
  };
}

export function settleWorkflowTerminalDispatch(
  lifecycle: WorkflowTerminalLifecycle,
  result:
    | { state: "accepted"; descriptor: RuntimeSessionDescriptor }
    | { state: "uncertain" | "failed"; error: string },
  now = Date.now(),
): WorkflowTerminalLifecycle {
  const cleanupRequired = result.state !== "failed";
  return {
    ...lifecycle,
    dispatch: {
      ...lifecycle.dispatch,
      state: result.state,
      settledAt: now,
      ...(result.state === "accepted"
        ? {
            session: {
              id: result.descriptor.id,
              aliases: normalizedAliases(result.descriptor),
            },
          }
        : { lastError: result.error }),
    },
    cleanup: cleanupRequired
      ? {
          ...lifecycle.cleanup,
          requested: true,
          state: "pending",
          requestedAt: lifecycle.cleanup.requestedAt ?? now,
          nextAttemptAt: lifecycle.cleanup.nextAttemptAt ?? now,
          ...(result.state === "uncertain"
            ? { lastError: result.error }
            : { lastError: undefined }),
        }
      : {
          requested: false,
          state: "not_requested",
          reason: lifecycle.cleanup.reason,
          attempt: 0,
        },
  };
}

export function requestWorkflowTerminalCleanupState(
  lifecycle: WorkflowTerminalLifecycle,
  reason = "workflow_completed_resumable",
  now = Date.now(),
): WorkflowTerminalLifecycle {
  if (lifecycle.cleanup.state === "released") return lifecycle;
  if (
    lifecycle.cleanup.state === "leased" &&
    (lifecycle.cleanup.leaseUntil ?? 0) > now
  ) {
    return {
      ...lifecycle,
      cleanup: {
        ...lifecycle.cleanup,
        requested: true,
        reason,
        requestedAt: lifecycle.cleanup.requestedAt ?? now,
      },
    };
  }
  return {
    ...lifecycle,
    cleanup: {
      ...lifecycle.cleanup,
      requested: true,
      state: "pending",
      reason,
      requestedAt: lifecycle.cleanup.requestedAt ?? now,
      nextAttemptAt: now,
      leaseUntil: undefined,
    },
  };
}
