import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { scheduledJobs, workflowTemplates } from "@/lib/db/schema";
import { getScheduledJob, reactivateScheduledJob } from "@/lib/db/queries/scheduled-jobs";
import { resetCoreTables } from "@/test/db";

describe("scheduled jobs reactivation", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("re-enabling a failed maintenance schedule resets pending status and next run", () => {
    const jobId = nanoid();
    const pastRunAt = Math.floor(Date.now() / 1000) - 3600;

    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: "maintenance:simulation-transcript-retention",
        status: "failed",
        enabled: 0,
        runAt: pastRunAt,
        cronExpression: "0 0 * * *",
        error: "maintenance sweep failed",
        payload: "{}",
      })
      .run();

    const job = reactivateScheduledJob(jobId)!;

    expect(job.enabled).toBe(1);
    expect(job.status).toBe("pending");
    expect(job.error).toBeNull();
    expect(job.runAt).toBeGreaterThan(pastRunAt);
    expect(getScheduledJob(jobId)?.status).toBe("pending");
  });

  it("does not reactivate agent template schedules locally", () => {
    const templateId = nanoid();
    db.insert(workflowTemplates)
      .values({
        id: templateId,
        name: "Test Template",
        templateType: "prospecting",
        status: "active",
        config: "{}",
      })
      .run();

    const jobId = nanoid();

    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: "workflow",
        templateId,
        status: "failed",
        enabled: 0,
        runAt: Math.floor(Date.now() / 1000) - 3600,
        cronExpression: "0 0 * * *",
        error: "AGENT_ORCHESTRATION_UNAVAILABLE",
        payload: "{}",
      })
      .run();

    expect(reactivateScheduledJob(jobId)).toBeUndefined();
    expect(getScheduledJob(jobId)?.enabled).toBe(0);
    expect(getScheduledJob(jobId)?.status).toBe("failed");
  });
});
