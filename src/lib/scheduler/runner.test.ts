import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { scheduledJobs, workflowTemplates } from "@/lib/db/schema";
import { getScheduledJob } from "@/lib/db/queries/scheduled-jobs";
import { executeScheduledJob } from "@/lib/scheduler/runner";
import { SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE } from "@/lib/db/simulation-transcript-retention";
import { resetCoreTables } from "@/test/db";

describe("scheduler runner", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.useRealTimers();
  });

  it("dispatches typed maintenance jobs without templateId", () => {
    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);

    db.insert(scheduledJobs)
      .values({
        id,
        jobType: SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE,
        status: "pending",
        runAt: now - 10,
        enabled: 1,
        payload: "{}",
      })
      .run();

    executeScheduledJob(id);

    expect(getScheduledJob(id)?.status).toBe("completed");
  });

  it("reschedules recurring maintenance jobs", () => {
    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);

    db.insert(scheduledJobs)
      .values({
        id,
        jobType: SIMULATION_TRANSCRIPT_RETENTION_JOB_TYPE,
        status: "pending",
        runAt: now - 10,
        enabled: 1,
        payload: "{}",
        cronExpression: "0 0 * * *",
      })
      .run();

    executeScheduledJob(id);

    const job = getScheduledJob(id)!;
    expect(job.status).toBe("pending");
    expect(job.runAt).toBeGreaterThan(now);
    expect(job.lastTriggeredAt).toBeTruthy();
  });

  it("fails unknown job_type without templateId", () => {
    const id = nanoid();
    const now = Math.floor(Date.now() / 1000);

    db.insert(scheduledJobs)
      .values({
        id,
        jobType: "maintenance:unknown",
        status: "pending",
        runAt: now - 10,
        enabled: 1,
        payload: "{}",
      })
      .run();

    executeScheduledJob(id);

    expect(getScheduledJob(id)?.status).toBe("failed");
    expect(getScheduledJob(id)?.error).toMatch(/Unknown job_type/);
  });

  it("still runs template-backed jobs", () => {
    const templateId = nanoid();
    db.insert(workflowTemplates)
      .values({
        id: templateId,
        name: "Test Search",
        templateType: "prospecting",
        status: "active",
        config: "{}",
      })
      .run();

    const jobId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: "template",
        templateId,
        status: "pending",
        runAt: now - 10,
        enabled: 1,
        payload: "{}",
      })
      .run();

    executeScheduledJob(jobId);

    expect(getScheduledJob(jobId)?.status).toBe("completed");
  });
});
