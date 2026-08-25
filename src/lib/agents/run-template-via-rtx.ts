import {
  createWorkflowRun,
  createWorkflowStep,
  getWorkflowRun,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { getTemplate, updateTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowRun, WorkflowTemplate } from "@/lib/db/types";
import { getPlatformTargetById } from "@/lib/db/queries/platform-targets";
import { isContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import {
  buildAgentWorkflowBrief,
  buildTemplateThreadName,
  mergeRunConfig,
} from "@/lib/workflows/template-brief";
import {
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { getOrCreateTemplateThread } from "@/lib/rtx/template-thread";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { resolveSignalsBaseUrlFromEnv } from "@/lib/rtx/resolve-signals-base-url";
import {
  dispatchTerminalAgentViaSendMessage,
  openRtxRuntimeLauncher,
} from "@/lib/rtx/runtime-sessions";
import {
  buildWorkflowRunBriefRoutingMessage,
  workflowRunBriefRelativePath,
  writeRtxWorkspaceBriefFile,
} from "@/lib/rtx/workspace-brief-files";
import type { TemplateThreadResolution } from "@/lib/rtx/template-thread";
import type { WorkflowType } from "@/lib/workflows/types";

const TEMPLATE_TO_WORKFLOW_TYPE: Record<string, WorkflowType> = {
  prospecting: "search",
  enrichment: "enrich",
  pruning: "prune",
  outreach: "sequence",
  engagement: "agent",
  content: "agent",
  nurture: "agent",
};

export type RunTemplateViaRtxInput = {
  templateId: string;
  config?: Record<string, unknown>;
  systemPrompt?: string;
  /** Base URL of the running Signals instance (derive from the incoming HTTP request). */
  signalsBaseUrl?: string;
  /** Run in a throwaway thread instead of the template's dedicated one. */
  freshThread?: boolean;
  /** Existing run ID if already pre-created (e.g. by cascade dispatcher). */
  existingRunId?: string;
};

export type RunTemplateViaRtxResult =
  | {
      success: true;
      workflowRunId: string;
      workspaceSlug: string;
      threadSlug: string;
      threadPath: string;
      threadResolution: TemplateThreadResolution;
      workflowRun: WorkflowRun;
    }
  | {
      success: false;
      error: string;
      errorCode: string;
      httpStatus: number;
      workflowRunId?: string;
    };

function buildStoredRunConfig(
  template: WorkflowTemplate,
  mergedConfig: Record<string, unknown>,
  rtx: { workspaceSlug: string; threadSlug: string; runtimeSessionId?: string }
): string {
  return JSON.stringify({
    ...mergedConfig,
    templateName: template.name,
    templateCategory: template.templateType,
    rtxWorkspaceSlug: rtx.workspaceSlug,
    rtxThreadSlug: rtx.threadSlug,
    rtxRuntimeSessionId: rtx.runtimeSessionId ?? null,
  });
}

export function getRtxRefsFromRunConfig(config: string | null | undefined): {
  workspaceSlug: string | null;
  threadSlug: string | null;
} {
  try {
    const parsed = JSON.parse(config ?? "{}") as Record<string, unknown>;
    return {
      workspaceSlug:
        typeof parsed.rtxWorkspaceSlug === "string" ? parsed.rtxWorkspaceSlug : null,
      threadSlug: typeof parsed.rtxThreadSlug === "string" ? parsed.rtxThreadSlug : null,
    };
  } catch {
    return { workspaceSlug: null, threadSlug: null };
  }
}

export function getRtxRuntimeSessionIdFromRunConfig(
  config: string | null | undefined
): string | null {
  try {
    const parsed = JSON.parse(config ?? "{}") as Record<string, unknown>;
    return typeof parsed.rtxRuntimeSessionId === "string"
      ? parsed.rtxRuntimeSessionId
      : null;
  } catch {
    return null;
  }
}

async function verifySignalsHealth(
  signalsBaseUrl: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${signalsBaseUrl.replace(/\/+$/, "")}/api/health`;
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      return {
        ok: false,
        error: `Signals health check failed (${response.status}) at ${url}`,
      };
    }
    const body = (await response.json()) as { app?: string; status?: string };
    if (body.app !== "signals" || body.status !== "ok") {
      return {
        ok: false,
        error: `Signals health check returned unexpected payload at ${url}`,
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    return {
      ok: false,
      error: `Signals health check failed at ${url}: ${message}`,
    };
  }
}

export async function runTemplateViaRtx(
  input: RunTemplateViaRtxInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RunTemplateViaRtxResult> {
  if (!isRtxEmbedded(env)) {
    return {
      success: false,
      error: "Agent workflows require the RealTimeX Local App",
      errorCode: "standalone",
      httpStatus: 400,
    };
  }

  const template = getTemplate(input.templateId);
  if (!template) {
    return {
      success: false,
      error: "Template not found",
      errorCode: "not_found",
      httpStatus: 404,
    };
  }

  let mergedConfig = mergeRunConfig(template, input.config);
  if (
    isContactNurtureTemplateConfig(mergedConfig) &&
    typeof mergedConfig.targetId === "string" &&
    mergedConfig.targetId.trim()
  ) {
    const target = getPlatformTargetById(mergedConfig.targetId.trim());
    if (target) {
      mergedConfig = {
        ...mergedConfig,
        targetPlatform: target.platform,
        targetName: target.name,
        targetHandle: target.handle,
      };
    }
  }
  const workflowType = TEMPLATE_TO_WORKFLOW_TYPE[template.templateType] ?? "agent";
  const now = Math.floor(Date.now() / 1000);

  let run: WorkflowRun;
  if (input.existingRunId) {
    const existing = getWorkflowRun(input.existingRunId);
    if (existing) {
      updateWorkflowRun(existing.id, {
        status: "running",
        startedAt: now,
        config: JSON.stringify({
          ...mergedConfig,
          templateName: template.name,
          templateCategory: template.templateType,
        }),
      });
      run = getWorkflowRun(existing.id)!;
    } else {
      run = createWorkflowRun({
        templateId: template.id,
        workflowType,
        status: "running",
        config: JSON.stringify({
          ...mergedConfig,
          templateName: template.name,
          templateCategory: template.templateType,
        }),
        trigger: "template",
        startedAt: now,
      });
    }
  } else {
    run = createWorkflowRun({
      templateId: template.id,
      workflowType,
      status: "running",
      config: JSON.stringify({
        ...mergedConfig,
        templateName: template.name,
        templateCategory: template.templateType,
      }),
      trigger: "template",
      startedAt: now,
    });
  }

  const signalsBaseUrl = input.signalsBaseUrl ?? resolveSignalsBaseUrlFromEnv(env);
  const health = await verifySignalsHealth(signalsBaseUrl, fetchImpl);
  if (!health.ok) {
    updateWorkflowRun(run.id, {
      status: "failed",
      completedAt: now,
      errors: JSON.stringify([health.error]),
      errorItems: 1,
    });
    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: nextStepIndex(run.id),
      stepType: "error",
      status: "failed",
      tool: "signals_health_preflight",
      error: health.error,
      durationMs: 0,
    });
    return {
      success: false,
      error: health.error,
      errorCode: "signals_not_running",
      httpStatus: 503,
      workflowRunId: run.id,
    };
  }

  try {
    const workspaceSlug = await ensureRtxWorkspace(
      getSignalsRtxWorkspaceSlug(env),
      "Signals",
      env,
      fetchImpl
    );
    const { threadSlug, resolution: threadResolution } =
      await getOrCreateTemplateThread(
        {
          template,
          workspaceSlug,
          threadName: buildTemplateThreadName(template.name),
          freshThread: input.freshThread,
        },
        env,
        fetchImpl
      );

    let runtimeConfig = { ...mergedConfig };
    if (typeof mergedConfig.targetId === "string" && !mergedConfig.targetPlatform) {
      const target = getPlatformTargetById(mergedConfig.targetId);
      if (target) {
        runtimeConfig = {
          ...runtimeConfig,
          targetPlatform: target.platform,
          targetName: target.name || target.handle,
          targetHandle: target.handle,
        };
      }
    }

    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: run.id,
      config: runtimeConfig,
      signalsBaseUrl,
      systemPromptOverride: input.systemPrompt,
    });

    const briefPath = workflowRunBriefRelativePath(run.id);
    const briefWrite = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      briefPath,
      brief,
      env
    );
    if (!briefWrite.success) {
      throw new Error(briefWrite.error);
    }

    const launch = await dispatchTerminalAgentViaSendMessage(
      {
        workspaceSlug,
        threadSlug,
        message: buildWorkflowRunBriefRoutingMessage({
          templateName: template.name,
          runId: run.id,
          runNumber: template.totalRuns + 1,
          absolutePath: briefWrite.absolutePath,
        }),
        reason: `Run agent workflow template ${template.name} (${template.id})`,
      },
      env,
      fetchImpl
    );

    if (!launch.success) {
      const errorMessage = launch.error;
      updateWorkflowRun(run.id, {
        status: "failed",
        completedAt: now,
        errors: JSON.stringify([errorMessage]),
        errorItems: 1,
      });
      createWorkflowStep({
        workflowRunId: run.id,
        stepIndex: nextStepIndex(run.id),
        stepType: "error",
        status: "failed",
        tool: "rtx_terminal_agent",
        error: errorMessage,
        durationMs: 0,
      });

      const httpStatus =
        launch.errorCode === "permission_required"
          ? 403
          : launch.errorCode === "standalone"
            ? 400
            : launch.errorCode === "terminal_dispatch_required"
              ? 409
            : launch.errorCode === "launch_failed"
              ? 502
              : 503;

      return {
        success: false,
        error: errorMessage,
        errorCode: launch.errorCode,
        httpStatus,
        workflowRunId: run.id,
      };
    }

    const resolvedWorkspace = launch.descriptor.linkage?.workspaceSlug ?? workspaceSlug;
    const resolvedThread = launch.descriptor.linkage?.threadSlug ?? threadSlug;

    const updatedRun = updateWorkflowRun(run.id, {
      config: buildStoredRunConfig(template, mergedConfig, {
        workspaceSlug: resolvedWorkspace,
        threadSlug: resolvedThread,
        runtimeSessionId: launch.descriptor.id,
      }),
    });

    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: nextStepIndex(run.id),
      stepType: "tool_call",
      status: "completed",
      tool: "rtx_terminal_agent",
      input: JSON.stringify({ templateId: template.id, threadSlug: resolvedThread }),
      output: JSON.stringify({
        runtimeSessionId: launch.descriptor.id,
        threadResolution,
      }),
      durationMs: 0,
    });

    updateTemplate(template.id, {
      totalRuns: template.totalRuns + 1,
      lastRunAt: now,
    });

    await openRtxRuntimeLauncher(
      {
        workspaceSlug: resolvedWorkspace,
        threadSlug: resolvedThread,
        reason: `Open agent workflow run ${run.id}`,
      },
      env,
      fetchImpl
    );

    return {
      success: true,
      workflowRunId: run.id,
      workspaceSlug: resolvedWorkspace,
      threadSlug: resolvedThread,
      threadPath: `/workspace/${resolvedWorkspace}/t/${resolvedThread}`,
      threadResolution,
      workflowRun: updatedRun ?? run,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    updateWorkflowRun(run.id, {
      status: "failed",
      completedAt: now,
      errors: JSON.stringify([message]),
      errorItems: 1,
    });
    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: nextStepIndex(run.id),
      stepType: "error",
      status: "failed",
      tool: "rtx_terminal_agent",
      error: message,
      durationMs: 0,
    });
    return {
      success: false,
      error: message,
      errorCode: "launch_failed",
      httpStatus: 502,
      workflowRunId: run.id,
    };
  }
}
