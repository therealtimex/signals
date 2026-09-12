import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import {
  getSignalsRtxWorkspaceSlug,
  resolveNetworkSnowballDispatchThread,
  resolveSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { scheduleWorkflowTerminalSessionRelease } from "@/lib/rtx/resource-teardown";
import { resolveActiveTerminalSessionIdForThread } from "@/lib/rtx/runtime-sessions";
import {
  NETWORK_SNOWBALL_TEMPLATE_NAME,
  sanitizeNetworkSnowballConfigRecord,
} from "@/lib/workflows/network-snowball";

export const SNOWBALL_CALENDAR_DISPATCH_CONFIG_KEY = "_snowballCalendarDispatch";

export type SnowballCalendarDispatchContext = {
  calendarEventUuid: string;
  taskUuid: string;
  dispatchKind: "workflow.run";
  workflowTemplate: typeof NETWORK_SNOWBALL_TEMPLATE_NAME;
  workflowRunConfig: Record<string, unknown>;
};

export type SnowballCalendarDispatchResult = {
  success: boolean;
  workflowRunId: string | null;
  workflowStatus: string | null;
  duplicate: boolean;
  calendarTaskAcknowledged: boolean;
  calendarTaskError?: string;
  dispatcherTerminalSessionId: string | null;
  dispatcherReleaseScheduled: boolean;
  error?: string;
};

export function snowballCalendarWorkflowRunId(taskUuid: string): string {
  return `calendar-${taskUuid}`;
}

function reserveCalendarWorkflowRun(
  context: SnowballCalendarDispatchContext,
  templateId: string,
) {
  const id = snowballCalendarWorkflowRunId(context.taskUuid);
  const existing = getWorkflowRun(id);
  if (existing) return { run: existing, duplicate: true };

  const config = {
    ...sanitizeNetworkSnowballConfigRecord(context.workflowRunConfig),
    [SNOWBALL_CALENDAR_DISPATCH_CONFIG_KEY]: {
      version: 1,
      taskUuid: context.taskUuid,
      calendarEventUuid: context.calendarEventUuid,
    },
  };

  try {
    const run = createWorkflowRun({
      id,
      templateId,
      workflowType: "search",
      status: "pending",
      trigger: "template",
      config: JSON.stringify(config),
    });
    return { run, duplicate: false };
  } catch (error) {
    // A second delivery can race the first before either has acknowledged the
    // Calendar task. The deterministic primary key is the idempotency boundary.
    const raced = getWorkflowRun(id);
    if (raced) return { run: raced, duplicate: true };
    throw error;
  }
}

async function acknowledgeCalendarTask(
  input: {
    taskUuid: string;
    success: boolean;
    workflowRunId: string | null;
    error?: string;
  },
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<{ acknowledged: boolean; error?: string }> {
  const apiBase = resolveRtxApiBase(env);
  if (!apiBase) {
    return { acknowledged: false, error: "RealTimeX API base URL is not configured" };
  }

  const url = `${apiBase}/api/external-tasks/${encodeURIComponent(input.taskUuid)}/webhook`;
  const body = JSON.stringify({
    action: input.success ? "completed" : "failed",
    machine_id: "signals",
    data: {
      agent_name: "cursor",
      workflowRunId: input.workflowRunId,
      ...(input.error ? { error: { message: input.error } } : {}),
    },
    timestamp: new Date().toISOString(),
  });
  let lastError = "Calendar task acknowledgement failed";

  // The workflow launch is idempotently reserved before this callback. Retry the
  // small local write here so a transient host response cannot strand the task.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (response.ok && payload.success !== false) {
        return { acknowledged: true };
      }
      lastError = payload.error || `RealTimeX external-task webhook responded ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  return { acknowledged: false, error: lastError };
}

async function scheduleDispatcherRelease(
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<{
  sessionId: string | null;
  scheduled: boolean;
  error?: string;
}> {
  try {
    let workspaceSlug = getSignalsRtxWorkspaceSlug(env);
    try {
      workspaceSlug = await resolveSignalsRtxWorkspaceSlug(env, fetchImpl);
    } catch {
      // The configured workspace remains a valid fallback for cleanup.
    }
    const threadSlug = await resolveNetworkSnowballDispatchThread(
      workspaceSlug,
      env,
      fetchImpl,
    );
    const sessionId = await resolveActiveTerminalSessionIdForThread(
      workspaceSlug,
      threadSlug,
      env,
      fetchImpl,
    );
    const release = scheduleWorkflowTerminalSessionRelease(sessionId, env, fetchImpl);
    return {
      sessionId,
      scheduled: release.scheduled && Boolean(release.sessionId),
    };
  } catch (error) {
    return {
      sessionId: null,
      scheduled: false,
      error: error instanceof Error ? error.message : "Dispatcher cleanup failed",
    };
  }
}

export async function dispatchSnowballCalendarTask(
  context: SnowballCalendarDispatchContext,
  signalsBaseUrl: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SnowballCalendarDispatchResult> {
  let workflowRunId: string | null = null;
  let workflowStatus: string | null = null;
  let duplicate = false;
  let launchError: string | undefined;

  const template = getSystemTemplateByName(context.workflowTemplate);
  if (!template) {
    launchError = `Workflow template '${context.workflowTemplate}' not found`;
  } else {
    const reservation = reserveCalendarWorkflowRun(context, template.id);
    workflowRunId = reservation.run.id;
    workflowStatus = reservation.run.status;
    duplicate = reservation.duplicate;

    if (reservation.run.status === "pending") {
      const launch = await runTemplateViaRtx({
        templateId: template.id,
        config: {
          ...sanitizeNetworkSnowballConfigRecord(context.workflowRunConfig),
          [SNOWBALL_CALENDAR_DISPATCH_CONFIG_KEY]: {
            version: 1,
            taskUuid: context.taskUuid,
            calendarEventUuid: context.calendarEventUuid,
          },
        },
        signalsBaseUrl,
        existingRunId: reservation.run.id,
      }, env as NodeJS.ProcessEnv, fetchImpl);
      if (!launch.success) {
        launchError = launch.error;
      }
      const launchedRun = getWorkflowRun(reservation.run.id);
      workflowStatus = launchedRun?.status ?? (launch.success ? "running" : "failed");
    } else if (
      reservation.run.status === "failed" ||
      reservation.run.status === "cancelled"
    ) {
      launchError = `Workflow run ${reservation.run.id} is already ${reservation.run.status}`;
    }
  }

  const launched = !launchError && Boolean(workflowRunId);
  const [calendarTask, dispatcherRelease] = await Promise.all([
    acknowledgeCalendarTask(
      {
        taskUuid: context.taskUuid,
        success: launched,
        workflowRunId,
        error: launchError,
      },
      env,
      fetchImpl,
    ),
    scheduleDispatcherRelease(env, fetchImpl),
  ]);

  const completed = launched && calendarTask.acknowledged;
  const completionError = launchError ?? calendarTask.error;

  return {
    success: completed,
    workflowRunId,
    workflowStatus,
    duplicate,
    calendarTaskAcknowledged: calendarTask.acknowledged,
    ...(calendarTask.error ? { calendarTaskError: calendarTask.error } : {}),
    dispatcherTerminalSessionId: dispatcherRelease.sessionId,
    dispatcherReleaseScheduled: dispatcherRelease.scheduled,
    ...(completionError ? { error: completionError } : {}),
    ...(!dispatcherRelease.scheduled && dispatcherRelease.error
      ? {
          error: completionError
            ? `${completionError} Dispatcher cleanup failed: ${dispatcherRelease.error}`
            : `Dispatcher cleanup failed: ${dispatcherRelease.error}`,
        }
      : {}),
  };
}
