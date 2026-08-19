import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  countProfilePipelineBacklog,
  countProfilePipelineBacklogAmong,
  PIPELINE_PLANNERS,
  ProfilePipelineValidationError,
  resolveProfilePipelineFilters,
  type ProfilePipelineRunInput,
  type ProfilePipelineRunPlan,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { getTemplate, updateTemplate } from "@/lib/db/queries/workflow-templates";
import {
  createWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { workflowRuns } from "@/lib/db/schema";
import type { WorkflowRun } from "@/lib/db/types";
import {
  createRtxPublishThread,
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { appendRtxThreadMessage } from "@/lib/rtx/runtime-sessions";
import { ensureProfilePipelineDrainJob } from "@/lib/db/profile-pipeline-drain";
import { buildPipelineThreadName } from "@/lib/workflows/template-brief";
import { PIPELINE_STEP_HANDLERS } from "@/lib/workflows/pipeline/handlers";
import {
  recordDistributedPipelineContactSteps,
  recordPipelineContactStep,
} from "@/lib/workflows/pipeline/record-pipeline-contact-steps";
import type {
  PipelineConfig,
  PipelineContactOutcome,
  PipelineContactStepTiming,
  PipelineRunResult,
  PipelineStepReport,
} from "@/lib/workflows/pipeline/types";
import {
  getValidatedPipelineFromTemplate,
  profilePipelineRunInputSchema,
} from "@/lib/workflows/pipeline/validate-pipeline-config";
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

const STEP_TOOL_BY_HANDLER: Record<string, string> = {
  hydrate_x_profiles: "x_profile_hydrate",
  enrich_contact_avatars: "avatar_enrich",
  generate_persona: "generate_persona",
};

const STEP_LABELS: Record<string, string> = {
  hydrate: "X profile hydrate",
  avatar: "Avatar enrich",
  persona: "Persona generate",
};

export type RunPipelineTemplateInput = {
  templateId: string;
  input?: ProfilePipelineRunInput;
  trigger?: "template" | "scheduled";
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  /** When true, await step execution (scheduled drain / CLI). Default: detached promise. */
  waitForCompletion?: boolean;
};

export type RunPipelineTemplateResult =
  | {
      success: true;
      workflowRunId: string;
      plan: ProfilePipelineRunPlan;
      threadPath?: string;
      workflowRun: WorkflowRun;
    }
  | {
      success: false;
      error: string;
      errorCode: string;
      httpStatus: number;
      details?: unknown;
    };

type StoredPipelineRunConfig = {
  templateName: string;
  templateCategory: string;
  pipeline: { planner: string; steps: string[] };
  backlogTotal: number;
  batchSize: number;
  selectedContactIds: string[];
  filters: ReturnType<typeof resolveProfilePipelineFilters>;
  explicit: boolean;
  forcePersona: boolean;
  rtxWorkspaceSlug?: string;
  rtxThreadSlug?: string;
  rtxRuntimeSessionId?: string | null;
};

function hasActivePipelineRun(templateId: string): boolean {
  const active = db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.templateId, templateId), eq(workflowRuns.status, "running")),
    )
    .limit(1)
    .get();
  return active != null;
}

function parseRunErrors(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function mergeRunErrors(existing: string | null | undefined, message: string): string {
  return JSON.stringify([...parseRunErrors(existing), message]);
}

function formatKickoffMessage(plan: ProfilePipelineRunPlan): string {
  const processing = plan.selectedContactIds.length;
  return `**Contact profile pipeline** — backlog **${plan.backlogTotal}**, processing **${processing}** this run (weakest scores first).`;
}

function formatStepSummaryMessage(
  stepId: string,
  handler: string,
  report: PipelineStepReport,
): string {
  const label = STEP_LABELS[stepId] ?? stepId;
  const updated = report.outcomes.filter((o) => o.status === "updated").length;
  const verified = report.outcomes.filter((o) => o.status === "verified").length;
  const generated = report.outcomes.filter((o) => o.status === "generated").length;
  const skipped = report.outcomes.filter((o) => o.status === "skipped").length;
  const failed = report.outcomes.filter((o) => o.status === "failed").length;

  const skipReasons = new Map<string, number>();
  for (const outcome of report.outcomes) {
    if (outcome.status === "skipped" && outcome.reason) {
      skipReasons.set(outcome.reason, (skipReasons.get(outcome.reason) ?? 0) + 1);
    }
  }
  const skipDetail =
    skipReasons.size > 0
      ? ` (${[...skipReasons.entries()].map(([reason, count]) => `${reason} ${count}`).join(", ")})`
      : "";

  if (handler === "hydrate_x_profiles") {
    const notFound = report.outcomes.filter(
      (outcome) => outcome.status === "skipped" && outcome.reason === "not_found",
    ).length;
    const otherSkipped = Math.max(0, skipped - notFound);
    const hydrationSkipReasons = [...skipReasons.entries()].filter(
      ([reason]) => reason !== "not_found",
    );
    const hydrationSkipDetail = hydrationSkipReasons.length > 0
      ? ` (${hydrationSkipReasons.map(([reason, count]) => `${reason} ${count}`).join(", ")})`
      : "";
    const sharedReason = report.outcomes.length > 0 && report.outcomes.every(
      (outcome) => outcome.status === "skipped" && outcome.reason === report.outcomes[0]?.reason,
    )
      ? report.outcomes[0]?.reason
      : undefined;
    let hint = "";
    if (sharedReason === "x_not_connected") {
      hint = " Connect X to enable profile hydration.";
    } else if (sharedReason === "x_reauth_required") {
      hint = " Reconnect X to resume profile hydration.";
    } else if (sharedReason === "x_access_restricted") {
      hint = " The connected X API tier does not allow user lookup.";
    } else if (sharedReason === "x_rate_limited") {
      const retryAfter = report.outcomes[0]?.detail?.retryAfter;
      const minutes = typeof retryAfter === "number" ? Math.max(1, Math.ceil(retryAfter / 60)) : null;
      hint = minutes ? ` Retry in about ${minutes}m.` : " Retry after the X rate limit resets.";
    }
    return `**${label}** — hydrated **${updated}**, not found **${notFound}**, skipped **${otherSkipped}**${hydrationSkipDetail}, failed **${failed}**.${hint}`;
  }

  if (stepId === "persona" || report.outcomes.some((o) => o.status === "generated")) {
    return `**${label}** — generated **${generated}**, skipped **${skipped}**${skipDetail}, failed **${failed}**.`;
  }

  return `**${label}** — updated **${updated}**, gravatar verified **${verified}**, skipped **${skipped}**${skipDetail}, failed **${failed}**.`;
}

function formatFinalMessage(workflowRunId: string, result: PipelineRunResult): string {
  return `Processed **${result.processed}** · hydrated **${result.profilesHydrated}** · avatars **${result.avatarsUpdated}** · personas **${result.personasGenerated}** · **${result.remainingBacklog}** remaining. Run ${workflowRunId} completed.`;
}

function aggregateRunResult(input: {
  plan: ProfilePipelineRunPlan;
  stepReports: PipelineStepReport[];
  pipeline: PipelineConfig;
  filters: ReturnType<typeof resolveProfilePipelineFilters>;
}): PipelineRunResult {
  const selected = input.plan.selectedContactIds.length;
  const skipped: Record<string, number> = {};
  const failedContactIds = new Set<string>();
  let avatarsUpdated = 0;
  let profilesHydrated = 0;
  let personasGenerated = 0;
  let avatarUpdated = 0;
  let gravatarVerified = 0;
  let hydrationNotFound = 0;
  let aborted = 0;
  const handlerByStepId = new Map(
    input.pipeline.steps.map((step) => [step.id, step.handler]),
  );

  for (const report of input.stepReports) {
    const handler = handlerByStepId.get(report.stepId);
    for (const outcome of report.outcomes) {
      if (outcome.status === "failed") {
        failedContactIds.add(outcome.contactId);
      }
      if (outcome.status === "skipped" && outcome.reason) {
        skipped[outcome.reason] = (skipped[outcome.reason] ?? 0) + 1;
      }
      if (handler === "hydrate_x_profiles" && outcome.status === "updated") {
        profilesHydrated++;
      }
      if (
        handler === "hydrate_x_profiles" &&
        outcome.status === "skipped" &&
        outcome.reason === "not_found"
      ) {
        hydrationNotFound++;
      }
      if (handler === "enrich_contact_avatars" && outcome.status === "updated") {
        avatarUpdated++;
        avatarsUpdated++;
      }
      if (handler === "enrich_contact_avatars" && outcome.status === "verified") {
        gravatarVerified++;
        avatarsUpdated++;
      }
      if (handler === "generate_persona" && outcome.status === "generated") {
        personasGenerated++;
      }
    }

    if (report.aborted) {
      aborted += Math.max(0, selected - report.outcomes.length);
    }
  }

  const processed = Math.max(0, selected - aborted);
  const remainingBacklog = input.plan.explicit
    ? countProfilePipelineBacklogAmong(input.plan.selectedContactIds, input.filters)
    : countProfilePipelineBacklog(input.filters);

  const cleared = input.plan.selectedContactIds.filter(
    (contactId) =>
      countProfilePipelineBacklogAmong([contactId], input.filters) === 0,
  ).length;

  return {
    backlogTotal: input.plan.backlogTotal,
    batchSize: input.plan.batchSize,
    selected,
    processed,
    profilesHydrated,
    avatarsUpdated,
    personasGenerated,
    skipped,
    failed: failedContactIds.size,
    aborted,
    avatarOutcomes: { updated: avatarUpdated, gravatarVerified },
    hydrationOutcomes: { updated: profilesHydrated, notFound: hydrationNotFound },
    cleared,
    remainingBacklog,
    complete: remainingBacklog === 0,
  };
}

function computeRunStatus(
  result: PipelineRunResult,
  runErrors: string[],
): "completed" | "failed" {
  if (runErrors.some((e) => e.includes("Pipeline execution failed"))) {
    return "failed";
  }
  if (result.processed > 0 && result.failed === result.processed && result.aborted === 0) {
    return "failed";
  }
  return "completed";
}

function computeRunItemCounts(
  selectedContactIds: string[],
  stepReports: PipelineStepReport[],
): {
  processedItems: number;
  successItems: number;
  skippedItems: number;
  errorItems: number;
} {
  const successItems = new Set<string>();
  const failedContactIds = new Set<string>();
  for (const report of stepReports) {
    for (const outcome of report.outcomes) {
      if (
        outcome.status === "updated" ||
        outcome.status === "verified" ||
        outcome.status === "generated"
      ) {
        successItems.add(outcome.contactId);
      }
      if (outcome.status === "failed") {
        failedContactIds.add(outcome.contactId);
      }
    }
  }

  const touchedContacts = new Set(
    stepReports.flatMap((report) => report.outcomes.map((outcome) => outcome.contactId)),
  );

  return {
    processedItems: touchedContacts.size,
    successItems: successItems.size,
    skippedItems: countSkippedOnlyContacts(selectedContactIds, stepReports),
    errorItems: failedContactIds.size,
  };
}

function countSkippedOnlyContacts(
  contactIds: string[],
  stepReports: PipelineStepReport[],
): number {
  if (contactIds.length === 0) return 0;
  let skippedOnly = 0;
  for (const contactId of contactIds) {
    const outcomes = stepReports.flatMap((report) =>
      report.outcomes.filter((o) => o.contactId === contactId),
    );
    if (outcomes.length === 0) continue;
    if (outcomes.every((o) => o.status === "skipped")) {
      skippedOnly++;
    }
  }
  return skippedOnly;
}

export async function runPipelineTemplate(
  input: RunPipelineTemplateInput,
): Promise<RunPipelineTemplateResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const trigger = input.trigger ?? "template";

  const parsedInput = profilePipelineRunInputSchema.safeParse(input.input ?? {});
  if (!parsedInput.success) {
    return {
      success: false,
      error: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      httpStatus: 400,
      details: parsedInput.error.flatten(),
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

  const pipelineValidation = getValidatedPipelineFromTemplate(template.config);
  if (!pipelineValidation.success) {
    return {
      success: false,
      error: pipelineValidation.message,
      errorCode: pipelineValidation.errorCode,
      httpStatus: 400,
    };
  }

  const pipeline = pipelineValidation.pipeline;
  const planner = PIPELINE_PLANNERS[pipeline.planner as keyof typeof PIPELINE_PLANNERS];
  if (!planner) {
    return {
      success: false,
      error: `Unknown pipeline planner "${pipeline.planner}"`,
      errorCode: "VALIDATION_ERROR",
      httpStatus: 400,
    };
  }

  let plan: ProfilePipelineRunPlan;
  try {
    plan = planner.planRun({
      ...parsedInput.data,
      batchSize: parsedInput.data.batchSize ?? pipeline.batchSize,
      filters: {
        ...pipeline.filters,
        ...parsedInput.data.filters,
      },
    });
  } catch (error) {
    if (error instanceof ProfilePipelineValidationError) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        httpStatus: 400,
        details: { contactIds: error.invalidContactIds },
      };
    }
    throw error;
  }

  if (!plan.explicit && hasActivePipelineRun(template.id)) {
    return {
      success: false,
      error: "A pipeline run is already active for this template",
      errorCode: "PIPELINE_RUN_ACTIVE",
      httpStatus: 409,
    };
  }

  const forcePersona =
    trigger === "scheduled" ? false : (parsedInput.data.forcePersona ?? false);
  const scheduleDrain =
    parsedInput.data.scheduleDrain ?? pipeline.scheduleDrain ?? false;
  const now = Math.floor(Date.now() / 1000);
  const workflowType = TEMPLATE_TO_WORKFLOW_TYPE[template.templateType] ?? "enrich";

  const storedConfig: StoredPipelineRunConfig = {
    templateName: template.name,
    templateCategory: template.templateType,
    pipeline: {
      planner: pipeline.planner,
      steps: pipeline.steps.map((step) => step.id),
    },
    backlogTotal: plan.backlogTotal,
    batchSize: plan.batchSize,
    selectedContactIds: plan.selectedContactIds,
    filters: resolveProfilePipelineFilters(plan.filters),
    explicit: plan.explicit,
    forcePersona,
    rtxRuntimeSessionId: null,
  };

  const run = createWorkflowRun({
    templateId: template.id,
    workflowType,
    status: "running",
    config: JSON.stringify(storedConfig),
    trigger,
    startedAt: now,
    totalItems: plan.selectedContactIds.length,
  });

  createWorkflowStep({
    workflowRunId: run.id,
    stepIndex: nextStepIndex(run.id),
    stepType: "decision",
    status: "completed",
    tool: "profile_pipeline_planner",
    output: JSON.stringify(plan),
    durationMs: 0,
    createdAt: now,
  });

  let threadPath: string | undefined;
  let workspaceSlug: string | null = null;
  let threadSlug: string | null = null;
  let runErrors = parseRunErrors(run.errors);

  if (isRtxEmbedded(env)) {
    try {
      workspaceSlug = await ensureRtxWorkspace(
        getSignalsRtxWorkspaceSlug(env),
        "Signals",
        env,
        fetchImpl,
      );
      threadSlug = await createRtxPublishThread(
        workspaceSlug,
        buildPipelineThreadName(template.name),
        env,
        fetchImpl,
      );
      threadPath = `/workspace/${workspaceSlug}/t/${threadSlug}`;

      updateWorkflowRun(run.id, {
        config: JSON.stringify({
          ...storedConfig,
          rtxWorkspaceSlug: workspaceSlug,
          rtxThreadSlug: threadSlug,
          rtxRuntimeSessionId: null,
        }),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Thread provisioning failed";
      runErrors = [...runErrors, message];
      updateWorkflowRun(run.id, {
        errors: JSON.stringify(runErrors),
      });
    }
  }

  updateTemplate(template.id, {
    totalRuns: template.totalRuns + 1,
    lastRunAt: now,
  });

  const updatedRun =
    updateWorkflowRun(run.id, {
      errors: runErrors.length > 0 ? JSON.stringify(runErrors) : run.errors,
    }) ?? run;

  const execution = executePipelineRun({
    workflowRunId: run.id,
    templateId: template.id,
    pipeline,
    plan,
    forcePersona,
    scheduleDrain,
    trigger,
    workspaceSlug,
    threadSlug,
    fetchImpl,
    env,
  });

  if (input.waitForCompletion) {
    await execution.catch((error) => {
      const message = error instanceof Error ? error.message : "Pipeline execution failed";
      updateWorkflowRun(run.id, {
        status: "failed",
        completedAt: Math.floor(Date.now() / 1000),
        errors: mergeRunErrors(run.errors, `Pipeline execution failed: ${message}`),
        errorItems: 1,
      });
    });
  } else {
    void execution.catch((error) => {
      const message = error instanceof Error ? error.message : "Pipeline execution failed";
      updateWorkflowRun(run.id, {
        status: "failed",
        completedAt: Math.floor(Date.now() / 1000),
        errors: mergeRunErrors(run.errors, `Pipeline execution failed: ${message}`),
        errorItems: 1,
      });
    });
  }

  return {
    success: true,
    workflowRunId: run.id,
    plan,
    threadPath,
    workflowRun: updatedRun,
  };
}

type ExecutePipelineRunInput = {
  workflowRunId: string;
  templateId: string;
  pipeline: PipelineConfig;
  plan: ProfilePipelineRunPlan;
  forcePersona: boolean;
  scheduleDrain: boolean;
  trigger: "template" | "scheduled";
  workspaceSlug: string | null;
  threadSlug: string | null;
  fetchImpl: typeof fetch;
  env: EnvLike;
};

export async function executePipelineRun(input: ExecutePipelineRunInput): Promise<void> {
  const run = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, input.workflowRunId))
    .get();
  if (!run) return;

  let runErrors = parseRunErrors(run.errors);
  const appendThreadMessage = async (markdown: string) => {
    if (!input.workspaceSlug || !input.threadSlug) return;
    const result = await appendRtxThreadMessage(
      {
        workspaceSlug: input.workspaceSlug,
        threadSlug: input.threadSlug,
        message: markdown,
        reason: `Profile pipeline run ${input.workflowRunId}`,
      },
      input.env,
      input.fetchImpl,
    );
    if (!result.success) {
      runErrors = [...runErrors, result.error];
      updateWorkflowRun(input.workflowRunId, {
        errors: JSON.stringify(runErrors),
      });
    }
  };

  await appendThreadMessage(formatKickoffMessage(input.plan));

  const stepReports: PipelineStepReport[] = [];

  for (const stepDecl of input.pipeline.steps) {
    const handler = PIPELINE_STEP_HANDLERS[stepDecl.handler];
    if (!handler) {
      throw new Error(`Missing pipeline handler: ${stepDecl.handler}`);
    }

    const tool = STEP_TOOL_BY_HANDLER[stepDecl.handler] ?? stepDecl.handler;
    const recordedContactIds = new Set<string>();
    const recordContactOutcome = (
      outcome: PipelineContactOutcome,
      timing: PipelineContactStepTiming,
    ) => {
      recordPipelineContactStep({
        workflowRunId: input.workflowRunId,
        tool,
        outcome,
        durationMs: timing.durationMs,
        completedAtMs: timing.completedAtMs ?? Date.now(),
      });
      recordedContactIds.add(outcome.contactId);
    };

    const phaseStartedAtMs = Date.now();
    const report = await handler(input.plan.selectedContactIds, {
      workflowRunId: input.workflowRunId,
      stepId: stepDecl.id,
      trigger: input.trigger,
      forcePersona: input.forcePersona,
      personaStale: input.plan.filters.personaStale ?? false,
      fetchImpl: input.fetchImpl,
      env: input.env,
      options: stepDecl.options,
      appendThreadMessage,
      recordContactOutcome,
    });
    const phaseEndedAtMs = Date.now();

    stepReports.push(report);

    const unrecordedOutcomes = report.outcomes.filter(
      (outcome) => !recordedContactIds.has(outcome.contactId),
    );
    if (unrecordedOutcomes.length > 0) {
      recordDistributedPipelineContactSteps({
        workflowRunId: input.workflowRunId,
        tool,
        outcomes: unrecordedOutcomes,
        phaseStartedAtMs,
        phaseEndedAtMs,
      });
    }

    const stepSummary = summarizeStepReport(report);
    createWorkflowStep({
      workflowRunId: input.workflowRunId,
      stepIndex: nextStepIndex(input.workflowRunId),
      stepType: "decision",
      status: "completed",
      tool: "profile_pipeline_step_summary",
      output: JSON.stringify(stepSummary),
      durationMs: Math.max(phaseEndedAtMs - phaseStartedAtMs, 0),
      createdAt: Math.floor(phaseEndedAtMs / 1000),
    });

    await appendThreadMessage(formatStepSummaryMessage(stepDecl.id, stepDecl.handler, report));

    const incrementalCounts = computeRunItemCounts(
      input.plan.selectedContactIds,
      stepReports,
    );
    updateWorkflowRun(input.workflowRunId, incrementalCounts);

    if (report.aborted) {
      if (report.abortReason) {
        runErrors = [...runErrors, report.abortReason];
      }
      break;
    }
  }

  const result = aggregateRunResult({
    plan: input.plan,
    stepReports,
    pipeline: input.pipeline,
    filters: resolveProfilePipelineFilters(input.plan.filters),
  });

  const summaryCompletedAtMs = Date.now();
  createWorkflowStep({
    workflowRunId: input.workflowRunId,
    stepIndex: nextStepIndex(input.workflowRunId),
    stepType: "decision",
    status: "completed",
    tool: "profile_pipeline_summary",
    output: JSON.stringify(result),
    durationMs: 0,
    createdAt: Math.floor(summaryCompletedAtMs / 1000),
  });

  await appendThreadMessage(formatFinalMessage(input.workflowRunId, result));

  const finalCounts = computeRunItemCounts(
    input.plan.selectedContactIds,
    stepReports,
  );

  const finalStatus = computeRunStatus(result, runErrors);

  updateWorkflowRun(input.workflowRunId, {
    status: finalStatus,
    processedItems: result.processed,
    successItems: finalCounts.successItems,
    skippedItems: finalCounts.skippedItems,
    errorItems: result.failed,
    result: JSON.stringify(result),
    errors: runErrors.length > 0 ? JSON.stringify(runErrors) : "[]",
    completedAt: Math.floor(Date.now() / 1000),
  });

  if (
    input.scheduleDrain &&
    result.remainingBacklog > 0 &&
    runErrors.length === 0 &&
    result.cleared > 0
  ) {
    ensureProfilePipelineDrainJob(input.templateId);
  }
}

function summarizeStepReport(report: PipelineStepReport): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const outcome of report.outcomes) {
    const key = outcome.status === "skipped" && outcome.reason
      ? `skipped_${outcome.reason}`
      : outcome.status;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  if (report.aborted) {
    summary.aborted = 1;
  }
  return summary;
}
