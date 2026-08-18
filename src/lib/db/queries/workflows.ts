import { eq, and, desc, count, asc, sql, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowSteps } from "@/lib/db/schema";
import type {
  WorkflowRun,
  NewWorkflowRun,
  WorkflowStep,
  NewWorkflowStep,
  WorkflowRunWithSteps,
  PaginatedResult,
} from "@/lib/db/types";

// ── Workflow Runs ──────────────────────────────

export function createWorkflowRun(
  data: Omit<NewWorkflowRun, "id">
): WorkflowRun {
  const id = nanoid();
  db.insert(workflowRuns).values({ ...data, id }).run();
  return db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get()!;
}

export function updateWorkflowRun(
  id: string,
  data: Partial<
    Pick<
      WorkflowRun,
      | "status"
      | "totalItems"
      | "processedItems"
      | "successItems"
      | "skippedItems"
      | "errorItems"
      | "result"
      | "errors"
      | "startedAt"
      | "completedAt"
      | "model"
      | "inputTokens"
      | "outputTokens"
      | "costUsd"
      | "sourceTotal"
      | "sourceProcessed"
      | "config"
    >
  >
): WorkflowRun | undefined {
  const existing = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .get();
  if (!existing) return undefined;

  db.update(workflowRuns)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(workflowRuns.id, id))
    .run();

  return db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
}

export function getWorkflowRun(id: string): WorkflowRunWithSteps | undefined {
  const run = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, id))
    .get();
  if (!run) return undefined;

  const steps = db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowRunId, id))
    .orderBy(asc(workflowSteps.stepIndex))
    .all();

  return { ...run, steps };
}

export function listWorkflowRuns(opts?: {
  status?: WorkflowRun["status"];
  workflowType?: WorkflowRun["workflowType"];
  templateId?: string;
  page?: number;
  pageSize?: number;
}): PaginatedResult<WorkflowRun> {
  const conditions: SQL[] = [];

  if (opts?.status) {
    conditions.push(
      eq(
        workflowRuns.status,
        opts.status as "pending" | "running" | "paused" | "completed" | "failed" | "cancelled"
      )
    );
  }
  if (opts?.workflowType) {
    conditions.push(
      eq(
        workflowRuns.workflowType,
        opts.workflowType as
          | "sync"
          | "import"
          | "enrich"
          | "search"
          | "prune"
          | "sequence"
          | "agent"
          | "simulate"
          | "calibrate"
          | "persona"
      )
    );
  }
  if (opts?.templateId) {
    conditions.push(eq(workflowRuns.templateId, opts.templateId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ value: count() })
      .from(workflowRuns)
      .where(whereClause)
      .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const data = db
    .select()
    .from(workflowRuns)
    .where(whereClause)
    .orderBy(desc(workflowRuns.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

/**
 * Latest file-import run for a platform (config.platform), regardless of
 * status. Drives last-run stats on the Workflows import card.
 */
export function getLatestImportRun(platform: string): WorkflowRun | undefined {
  const runs = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowType, "import"))
    // rowid tiebreak: a combined upload (e.g. X archive contacts + posts)
    // records runs within the same epoch second — latest inserted wins.
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.startedAt), desc(sql`rowid`))
    .limit(50)
    .all();

  return runs.find((run) => {
    try {
      return JSON.parse(run.config ?? "{}").platform === platform;
    } catch {
      return false;
    }
  });
}

// ── Workflow Steps ─────────────────────────────

export function createWorkflowStep(
  data: Omit<NewWorkflowStep, "id">
): WorkflowStep {
  const id = nanoid();
  db.insert(workflowSteps).values({ ...data, id }).run();
  return db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.id, id))
    .get()!;
}

export function listWorkflowSteps(workflowRunId: string): WorkflowStep[] {
  return db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowRunId, workflowRunId))
    .orderBy(asc(workflowSteps.stepIndex))
    .all();
}

/** Get the next step index for a workflow run. */
export function nextStepIndex(workflowRunId: string): number {
  const last = db
    .select({ stepIndex: workflowSteps.stepIndex })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowRunId, workflowRunId))
    .orderBy(desc(workflowSteps.stepIndex))
    .limit(1)
    .get();
  return (last?.stepIndex ?? -1) + 1;
}
