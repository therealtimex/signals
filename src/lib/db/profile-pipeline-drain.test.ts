import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import {
  buildProfilePipelineFixture,
} from "@/lib/db/queries/profile-pipeline-backlog.test";
import { planProfilePipelineRun } from "@/lib/db/queries/profile-pipeline-backlog";
import { db } from "@/lib/db/client";
import { scheduledJobs, workflowRuns } from "@/lib/db/schema";
import * as drainModule from "@/lib/db/profile-pipeline-drain";
import {
  ensureProfilePipelineDrainJob,
  getPendingProfilePipelineDrainJobId,
  PROFILE_PIPELINE_DRAIN_JOB_TYPE,
  runProfilePipelineUntilCaughtUp,
} from "@/lib/db/profile-pipeline-drain";
import { executePipelineRun } from "@/lib/workflows/pipeline/run-pipeline-template";
import type { PipelineConfig } from "@/lib/workflows/pipeline/types";
import { executeScheduledJob } from "@/lib/scheduler/runner";
import { canReactivateScheduleLocally } from "@/lib/scheduler/schedule-policy";
import { resetCoreTables } from "@/test/db";

const pipelineConfig: PipelineConfig = {
  version: 1,
  planner: "contact_profile",
  batchSize: 20,
  filters: { needsAvatar: true, needsPersona: true, personaStale: false },
  scheduleDrain: true,
  steps: [
    { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
    { id: "persona", executor: "llm", handler: "generate_persona" },
  ],
};

function createPipelineTemplate(scheduleDrain = true) {
  return createTemplate({
    name: "Contact profile pipeline",
    description: "Drain test pipeline",
    templateType: "enrichment",
    status: "active",
    config: JSON.stringify({
      pipeline: { ...pipelineConfig, scheduleDrain },
    }),
    systemPrompt: "",
  });
}

describe("profile pipeline drain", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("enqueues a drain job with NULL templateId column (schedule-policy safe)", () => {
    buildProfilePipelineFixture();
    const template = createPipelineTemplate();

    expect(ensureProfilePipelineDrainJob(template.id)).toBe(true);

    const job = db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.jobType, PROFILE_PIPELINE_DRAIN_JOB_TYPE))
      .get();
    expect(job).toBeDefined();
    expect(job?.templateId).toBeNull();
    expect(JSON.parse(job?.payload ?? "{}")).toEqual({ templateId: template.id });
    expect(canReactivateScheduleLocally(job!)).toBe(true);
  });

  it("does not enqueue duplicate pending jobs for the same template", () => {
    buildProfilePipelineFixture();
    const template = createPipelineTemplate();

    expect(ensureProfilePipelineDrainJob(template.id)).toBe(true);
    expect(ensureProfilePipelineDrainJob(template.id)).toBe(false);
    expect(getPendingProfilePipelineDrainJobId(template.id)).not.toBeNull();
  });

  it("does not enqueue when backlog is empty", () => {
    const template = createPipelineTemplate();
    expect(ensureProfilePipelineDrainJob(template.id)).toBe(false);
  });

  it("does not schedule drain when scheduleDrain is false", async () => {
    const ensureSpy = vi.spyOn(drainModule, "ensureProfilePipelineDrainJob");
    buildProfilePipelineFixture();
    const template = createPipelineTemplate(true);
    const plan = planProfilePipelineRun({ batchSize: 5 });

    await executePipelineRun({
      workflowRunId: "run-no-drain",
      templateId: template.id,
      pipeline: pipelineConfig,
      plan,
      forcePersona: false,
      scheduleDrain: false,
      trigger: "template",
      workspaceSlug: null,
      threadSlug: null,
      fetchImpl: fetch,
      env: process.env,
    });

    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it("schedules drain only when remaining backlog, no errors, and cleared > 0", async () => {
    vi.spyOn(await import("@/lib/rtx/env"), "isRtxEmbedded").mockReturnValue(false);
    const ensureSpy = vi.spyOn(drainModule, "ensureProfilePipelineDrainJob");
    buildProfilePipelineFixture();
    const template = createPipelineTemplate(true);
    const plan = planProfilePipelineRun({ batchSize: 5 });

    await executePipelineRun({
      workflowRunId: "run-drain",
      templateId: template.id,
      pipeline: { ...pipelineConfig, scheduleDrain: true },
      plan,
      forcePersona: false,
      scheduleDrain: true,
      trigger: "template",
      workspaceSlug: null,
      threadSlug: null,
      fetchImpl: fetch,
      env: process.env,
    });

    const run = getWorkflowRun("run-drain");
    const result = JSON.parse(run?.result ?? "{}") as {
      cleared?: number;
      remainingBacklog?: number;
    };
    const runErrors = JSON.parse(run?.errors ?? "[]") as string[];

    if (
      (result.cleared ?? 0) > 0 &&
      (result.remainingBacklog ?? 0) > 0 &&
      runErrors.length === 0
    ) {
      expect(ensureSpy).toHaveBeenCalledWith(template.id);
    } else {
      expect(ensureSpy).not.toHaveBeenCalled();
    }
  });

  it("MAINTENANCE_HANDLERS entry runs pipeline from payload.templateId", async () => {
    vi.spyOn(await import("@/lib/rtx/env"), "isRtxEmbedded").mockReturnValue(false);
    buildProfilePipelineFixture();
    const template = createPipelineTemplate(false);

    const jobId = "drain-job-1";
    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: PROFILE_PIPELINE_DRAIN_JOB_TYPE,
        status: "pending",
        runAt: Math.floor(Date.now() / 1000),
        enabled: 1,
        payload: JSON.stringify({ templateId: template.id }),
        templateId: null,
      })
      .run();

    executeScheduledJob(jobId);

    await vi.waitFor(
      () => {
        const job = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, jobId)).get();
        expect(job?.status).toBe("completed");
      },
      { timeout: 30000 },
    );

    const runs = db.select().from(workflowRuns).all();
    expect(
      runs.some((run) => run.templateId === template.id && run.trigger === "scheduled"),
    ).toBe(true);
  });

  it("runUntilCaughtUp respects maxBatches and stops on errors", async () => {
    vi.spyOn(await import("@/lib/rtx/env"), "isRtxEmbedded").mockReturnValue(false);
    buildProfilePipelineFixture();
    const template = createPipelineTemplate(false);

    const report = await runProfilePipelineUntilCaughtUp(template.id, {
      maxBatches: 5,
      batchSize: 20,
    });

    expect(report.batchesExecuted).toBeGreaterThan(0);
    expect(report.batchesExecuted).toBeLessThanOrEqual(5);
    if (report.errors.length > 0) {
      expect(report.batchesExecuted).toBe(1);
    }
  });
});
