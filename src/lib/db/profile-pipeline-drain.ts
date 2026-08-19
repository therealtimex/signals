import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  countProfilePipelineBacklog,
  resolveProfilePipelineFilters,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { scheduledJobs } from "@/lib/db/schema";
import type { EnvLike } from "@/lib/rtx/env";
import { runPipelineTemplate } from "@/lib/workflows/pipeline/run-pipeline-template";
import type { PipelineRunResult } from "@/lib/workflows/pipeline/types";
import { getValidatedPipelineFromTemplate } from "@/lib/workflows/pipeline/validate-pipeline-config";

export const PROFILE_PIPELINE_DRAIN_JOB_TYPE = "maintenance:profile-pipeline-drain";

export type ProfilePipelineDrainReport = {
  batchesExecuted: number;
  complete: boolean;
  lastResult?: PipelineRunResult;
  errors: string[];
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function parseDrainPayload(raw: string | null | undefined): { templateId?: string } {
  try {
    return JSON.parse(raw ?? "{}") as { templateId?: string };
  } catch {
    return {};
  }
}

function findPendingDrainJobForTemplate(templateId: string): string | null {
  const rows = db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.jobType, PROFILE_PIPELINE_DRAIN_JOB_TYPE),
        eq(scheduledJobs.status, "pending"),
        eq(scheduledJobs.enabled, 1),
      ),
    )
    .all();

  for (const row of rows) {
    const payload = parseDrainPayload(row.payload);
    if (payload.templateId === templateId) return row.id;
  }
  return null;
}

export function getPendingProfilePipelineDrainJobId(templateId: string): string | null {
  return findPendingDrainJobForTemplate(templateId);
}

/** Enqueue a one-shot drain job when backlog remains (payload-carried template id, NULL templateId column). */
export function ensureProfilePipelineDrainJob(templateId: string, now = nowUnix()): boolean {
  if (findPendingDrainJobForTemplate(templateId)) return false;

  const template = getTemplate(templateId);
  if (!template) return false;

  const pipelineValidation = getValidatedPipelineFromTemplate(template.config);
  if (!pipelineValidation.success) return false;

  const filters = resolveProfilePipelineFilters(pipelineValidation.pipeline.filters);
  if (countProfilePipelineBacklog(filters) === 0) return false;

  const id = nanoid();
  db.insert(scheduledJobs)
    .values({
      id,
      jobType: PROFILE_PIPELINE_DRAIN_JOB_TYPE,
      status: "pending",
      runAt: now,
      enabled: 1,
      payload: JSON.stringify({ templateId }),
      templateId: null,
    })
    .run();
  return true;
}

/** Dev/CLI helper — loop scheduled pipeline runs until caught up or stopped. */
export async function runProfilePipelineUntilCaughtUp(
  templateId: string,
  opts?: {
    maxBatches?: number;
    batchSize?: number;
    fetchImpl?: typeof fetch;
    env?: EnvLike;
  },
): Promise<ProfilePipelineDrainReport> {
  const maxBatches = opts?.maxBatches ?? 5;
  let batchesExecuted = 0;
  let lastResult: PipelineRunResult | undefined;
  const errors: string[] = [];

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await runPipelineTemplate({
      templateId,
      trigger: "scheduled",
      input: opts?.batchSize != null ? { batchSize: opts.batchSize } : undefined,
      fetchImpl: opts?.fetchImpl,
      env: opts?.env,
      waitForCompletion: true,
    });

    if (!result.success) {
      errors.push(result.error);
      break;
    }

    batchesExecuted++;
    const run = getWorkflowRun(result.workflowRunId);
    if (!run?.result) break;

    try {
      lastResult = JSON.parse(run.result) as PipelineRunResult;
    } catch {
      break;
    }

    const runErrors = (() => {
      try {
        const parsed = JSON.parse(run.errors ?? "[]") as unknown;
        return Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === "string")
          : [];
      } catch {
        return [];
      }
    })();

    if (lastResult.complete || runErrors.length > 0 || lastResult.cleared === 0) {
      break;
    }
  }

  return {
    batchesExecuted,
    complete: lastResult?.complete ?? false,
    lastResult,
    errors,
  };
}
