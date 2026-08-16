import { eq, and, lte, sql, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db/client";
import { scheduledJobs } from "@/lib/db/schema";
import type { ScheduledJob, NewScheduledJob } from "@/lib/db/types";
import { canReactivateScheduleLocally } from "@/lib/scheduler/schedule-policy";

/** Compute the next run timestamp from a cron expression. Returns unix seconds. */
function nextRunFromCron(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}

export function createScheduledJob(
  data: Omit<NewScheduledJob, "id" | "runAt"> & { cronExpression: string }
): ScheduledJob {
  const id = nanoid();
  const runAt = nextRunFromCron(data.cronExpression);

  db.insert(scheduledJobs)
    .values({ ...data, id, runAt })
    .run();

  return getScheduledJob(id)!;
}

export function getScheduledJob(id: string): ScheduledJob | undefined {
  return db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
}

export function updateScheduledJob(
  id: string,
  data: Partial<Omit<NewScheduledJob, "id">>
): ScheduledJob | undefined {
  const existing = getScheduledJob(id);
  if (!existing) return undefined;

  // If cronExpression changes, recompute runAt
  const updates = { ...data };
  if (data.cronExpression && data.cronExpression !== existing.cronExpression) {
    updates.runAt = nextRunFromCron(data.cronExpression);
  }

  db.update(scheduledJobs)
    .set(updates)
    .where(eq(scheduledJobs.id, id))
    .run();

  return getScheduledJob(id);
}

export function deleteScheduledJob(id: string): boolean {
  const existing = getScheduledJob(id);
  if (!existing) return false;

  db.delete(scheduledJobs).where(eq(scheduledJobs.id, id)).run();
  return true;
}

export function listScheduledJobs(opts?: {
  enabled?: boolean;
  templateId?: string;
}): ScheduledJob[] {
  const conditions = [];

  if (opts?.enabled !== undefined) {
    conditions.push(eq(scheduledJobs.enabled, opts.enabled ? 1 : 0));
  }
  if (opts?.templateId) {
    conditions.push(eq(scheduledJobs.templateId, opts.templateId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(scheduledJobs)
    .where(where)
    .orderBy(desc(scheduledJobs.createdAt))
    .all();
}

/** Get all due jobs: enabled, status=pending, runAt <= now. */
export function getDueJobs(): ScheduledJob[] {
  const now = Math.floor(Date.now() / 1000);

  return db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.enabled, 1),
        eq(scheduledJobs.status, "pending"),
        lte(scheduledJobs.runAt, now)
      )
    )
    .all();
}

/** After executing a recurring job, compute the next run and reset status. */
export function rescheduleJob(id: string): ScheduledJob | undefined {
  const job = getScheduledJob(id);
  if (!job || !job.cronExpression) return undefined;

  const now = Math.floor(Date.now() / 1000);
  const nextRun = nextRunFromCron(job.cronExpression);

  db.update(scheduledJobs)
    .set({
      runAt: nextRun,
      status: "pending",
      lastTriggeredAt: now,
      startedAt: null,
      completedAt: null,
      error: null,
      retryCount: 0,
    })
    .where(eq(scheduledJobs.id, id))
    .run();

  return getScheduledJob(id);
}

export { nextRunFromCron };

/** Re-enable a schedule after failure or completion and restore a runnable pending state. */
export function reactivateScheduledJob(id: string): ScheduledJob | undefined {
  const job = getScheduledJob(id);
  if (!job) return undefined;
  if (!canReactivateScheduleLocally(job)) return undefined;

  const now = Math.floor(Date.now() / 1000);
  const updates: Partial<Omit<NewScheduledJob, "id">> = {
    enabled: 1,
    status: "pending",
    error: null,
    completedAt: null,
    startedAt: null,
    retryCount: 0,
    runAt: job.cronExpression ? nextRunFromCron(job.cronExpression) : now,
  };

  db.update(scheduledJobs)
    .set(updates)
    .where(eq(scheduledJobs.id, id))
    .run();

  return getScheduledJob(id);
}
