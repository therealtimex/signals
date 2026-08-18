import { createWorkflowRun, createWorkflowStep, nextStepIndex, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { getTemplate, updateTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowRun, WorkflowTemplate } from "@/lib/db/types";
import {
  buildAgentWorkflowBrief,
  buildAgentWorkflowThreadName,
  mergeRunConfig,
} from "@/lib/workflows/template-brief";
import {
  createRtxPublishThread,
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { launchTerminalCliAgent, openRtxRuntimeLauncher } from "@/lib/rtx/runtime-sessions";
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
};

export type RunTemplateViaRtxResult =
  | {
      success: true;
      workflowRunId: string;
      workspaceSlug: string;
      threadSlug: string;
      threadPath: string;
      workflowRun: WorkflowRun;
    }
  | {
      success: false;
      error: string;
      errorCode: string;
      httpStatus: number;
      workflowRunId?: string;
    };

function resolveSignalsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT?.trim() || "3010";
  return `http://127.0.0.1:${port}`;
}

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

  const mergedConfig = mergeRunConfig(template, input.config);
  const workflowType = TEMPLATE_TO_WORKFLOW_TYPE[template.templateType] ?? "agent";
  const now = Math.floor(Date.now() / 1000);

  const run = createWorkflowRun({
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

  try {
    const workspaceSlug = await ensureRtxWorkspace(
      getSignalsRtxWorkspaceSlug(env),
      "Signals",
      env,
      fetchImpl
    );
    const threadSlug = await createRtxPublishThread(
      workspaceSlug,
      buildAgentWorkflowThreadName(template.name),
      env,
      fetchImpl
    );

    const message = buildAgentWorkflowBrief({
      template,
      workflowRunId: run.id,
      config: mergedConfig,
      signalsBaseUrl: resolveSignalsBaseUrl(env),
      systemPromptOverride: input.systemPrompt,
    });

    const launch = await launchTerminalCliAgent(
      {
        workspaceSlug,
        threadSlug,
        message,
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
      output: JSON.stringify({ runtimeSessionId: launch.descriptor.id }),
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
