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
import { getLaunchById, upsertLaunch } from "@/lib/db/queries/launches";
import {
  isSignalsWritingTemplateConfig,
  readSignalsWritingTemplateConfig,
} from "@/lib/workflows/signals-writing";
import {
  buildAgentWorkflowBrief,
  mergeRunConfig,
  resolveTemplateThreadName,
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
import { getWritingApprovalPolicy } from "@/lib/settings/writing-approval-policy";
import { getContactById } from "@/lib/db/queries/contacts";
import { loadAndProjectContactToArpp } from "@/lib/arpp/load";
import {
  getContactWebResearchArppMissing,
  isContactWebResearchTemplateConfig,
  type ContactWebResearchBriefContext,
} from "@/lib/workflows/contact-web-research";
import {
  CONTACT_WEB_RESEARCH_SETTINGS_PATH,
  prepareContactWebResearchTarget,
  releaseContactWebResearchTarget,
  type ContactWebResearchPreparedTarget,
} from "@/lib/workflows/contact-web-research-target";

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
      details?: Record<string, unknown>;
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

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordWritingLaunchRun(input: {
  config: Record<string, unknown>;
  workflowRunId: string;
  startedAt: number;
  rtxThreadSlug: string;
}): void {
  if (!isSignalsWritingTemplateConfig(input.config)) return;
  const writingConfig = readSignalsWritingTemplateConfig(input.config);
  if (!writingConfig?.launchId) return;
  const launch = getLaunchById(writingConfig.launchId);
  if (!launch) return;
  const metadata = parseObject(launch.metadata);
  const writing = parseObject(metadata.writing);
  const priorRuns = Array.isArray(writing.runs)
    ? writing.runs.filter((run) => {
        const record = parseObject(run);
        return record.workflowRunId !== input.workflowRunId;
      })
    : [];
  upsertLaunch({
    id: launch.id,
    name: launch.name,
    status: launch.status === "draft" ? "generating" : launch.status,
    metadata: {
      ...metadata,
      writing: {
        ...writing,
        approvalPolicy: writing.approvalPolicy ?? getWritingApprovalPolicy(),
        runs: [
          ...priorRuns,
          {
            workflowRunId: input.workflowRunId,
            mode: writingConfig.mode,
            startedAt: input.startedAt,
            rtxThreadSlug: input.rtxThreadSlug,
          },
        ],
      },
    },
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

  let preparedLeaseId: string | null = null;
  let dispatchAccepted = false;
  const releaseLauncherOwnedLease = () => {
    if (!preparedLeaseId) return null;
    const leaseId = preparedLeaseId;
    preparedLeaseId = null;
    return releaseContactWebResearchTarget(leaseId);
  };

  try {
    const workspaceSlug = await ensureRtxWorkspace(
      getSignalsRtxWorkspaceSlug(env),
      "Signals",
      env,
      fetchImpl
    );
    const thread = await getOrCreateTemplateThread(
        {
          template,
          workspaceSlug,
          threadName: resolveTemplateThreadName(template),
          freshThread: input.freshThread,
        },
        env,
        fetchImpl
      );
    const { threadSlug, resolution: threadResolution } = thread;

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

    let researchTarget: ContactWebResearchPreparedTarget | undefined;
    if (isContactWebResearchTemplateConfig(runtimeConfig)) {
      const prepared = await prepareContactWebResearchTarget(
        { config: runtimeConfig, workflowRunId: run.id },
        env,
        fetchImpl,
      );
      if (!prepared.ok) {
        const completedAt = Math.floor(Date.now() / 1000);
        updateWorkflowRun(run.id, {
          status: "failed",
          completedAt,
          errors: JSON.stringify([prepared.error.message]),
          errorItems: 1,
          result: JSON.stringify({
            message: prepared.error.message,
            partial: true,
            blocked: prepared.error.code,
          }),
        });
        createWorkflowStep({
          workflowRunId: run.id,
          stepIndex: nextStepIndex(run.id),
          stepType: "error",
          status: "failed",
          tool: "platform_target_preflight",
          error: prepared.error.message,
          output: JSON.stringify({
            code: prepared.error.code,
            ...(prepared.error.details ?? {}),
          }),
          durationMs: 0,
        });
        return {
          success: false,
          error: prepared.error.message,
          errorCode: "research_target_unavailable",
          httpStatus: 409,
          workflowRunId: run.id,
          details: {
            reason: prepared.error.code,
            ...(prepared.error.details ?? {}),
            settingsPath: CONTACT_WEB_RESEARCH_SETTINGS_PATH,
            settingsTab: "Platform connections",
          },
        };
      }
      researchTarget = prepared.target;
      preparedLeaseId = researchTarget.leaseId;
      runtimeConfig = { ...runtimeConfig, researchTarget };
      updateWorkflowRun(run.id, {
        config: buildStoredRunConfig(template, runtimeConfig, {
          workspaceSlug,
          threadSlug,
        }),
      });
    }

    let contactWebResearchContext: ContactWebResearchBriefContext | undefined;
    if (researchTarget && typeof runtimeConfig.contactId === "string") {
      const contact = getContactById(runtimeConfig.contactId);
      const arpp = loadAndProjectContactToArpp(runtimeConfig.contactId, {
        visibility: "internal",
      });
      if (contact && arpp) {
        contactWebResearchContext = {
          contact,
          arppMissing: getContactWebResearchArppMissing(arpp),
          researchTarget,
        };
      }
    }
    if (researchTarget && !contactWebResearchContext) {
      throw new Error("Contact research context is unavailable");
    }

    const brief = buildAgentWorkflowBrief({
      template,
      workflowRunId: run.id,
      config: runtimeConfig,
      signalsBaseUrl,
      systemPromptOverride: input.systemPrompt,
      contactWebResearchContext,
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
      let errorMessage = launch.error;
      try {
        releaseLauncherOwnedLease();
      } catch (error) {
        errorMessage += ` Lease cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`;
      }
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
    dispatchAccepted = true;

    const resolvedWorkspace = launch.descriptor.linkage?.workspaceSlug ?? workspaceSlug;
    const resolvedThread = launch.descriptor.linkage?.threadSlug ?? threadSlug;

    recordWritingLaunchRun({
      config: mergedConfig,
      workflowRunId: run.id,
      startedAt: now,
      rtxThreadSlug: resolvedThread,
    });

    const updatedRun = updateWorkflowRun(run.id, {
      config: buildStoredRunConfig(template, runtimeConfig, {
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
        threadName: thread.threadName,
        renameAttempted: thread.renameAttempted,
        renamed: thread.renamed,
        ...(thread.renameError ? { renameError: thread.renameError } : {}),
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
    let message = error instanceof Error ? error.message : "Launch failed";
    if (!dispatchAccepted) {
      try {
        releaseLauncherOwnedLease();
      } catch (releaseError) {
        message += ` Lease cleanup failed: ${releaseError instanceof Error ? releaseError.message : "unknown error"}`;
      }
    }
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
