import { eq, and, desc, count, SQL, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  goals,
  goalWorkflows,
  goalProgress,
  workflowTemplates,
  workflowSteps,
} from "@/lib/db/schema";
import type {
  Goal,
  NewGoal,
  GoalWorkflow,
  GoalProgress as GoalProgressType,
  PaginatedResult,
} from "@/lib/db/types";

// ── Core CRUD ──────────────────────────────────

export function createGoal(
  data: Omit<NewGoal, "id">
): Goal {
  const id = nanoid();
  db.insert(goals).values({ ...data, id }).run();
  return db.select().from(goals).where(eq(goals.id, id)).get()!;
}

export type GoalWithWorkflows = Goal & {
  linkedWorkflows: (GoalWorkflow & { templateName: string })[];
  latestProgress: GoalProgressType | null;
};

export function getGoal(id: string): GoalWithWorkflows | undefined {
  const goal = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!goal) return undefined;

  const links = db
    .select({
      link: goalWorkflows,
      templateName: workflowTemplates.name,
    })
    .from(goalWorkflows)
    .innerJoin(workflowTemplates, eq(goalWorkflows.templateId, workflowTemplates.id))
    .where(eq(goalWorkflows.goalId, id))
    .all();

  const linkedWorkflows = links.map((r) => ({
    ...r.link,
    templateName: r.templateName,
  }));

  const latestProgress = db
    .select()
    .from(goalProgress)
    .where(eq(goalProgress.goalId, id))
    .orderBy(desc(goalProgress.snapshotAt))
    .limit(1)
    .get() ?? null;

  return { ...goal, linkedWorkflows, latestProgress };
}

export function listGoals(opts?: {
  status?: string;
  goalType?: string;
  page?: number;
  pageSize?: number;
}): PaginatedResult<Goal> {
  const conditions: SQL[] = [];

  if (opts?.status) {
    conditions.push(
      eq(goals.status, opts.status as "active" | "achieved" | "missed" | "paused")
    );
  }
  if (opts?.goalType) {
    conditions.push(
      eq(goals.goalType, opts.goalType as "audience_growth" | "lead_generation" | "content_engagement" | "pipeline_progression")
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total = db
    .select({ value: count() })
    .from(goals)
    .where(whereClause)
    .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const data = db
    .select()
    .from(goals)
    .where(whereClause)
    .orderBy(desc(goals.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

export function updateGoal(
  id: string,
  data: Partial<Pick<Goal, "name" | "goalType" | "platform" | "targetValue" | "currentValue" | "unit" | "deadline" | "status">>
): Goal | undefined {
  const existing = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!existing) return undefined;

  db.update(goals)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(goals.id, id))
    .run();

  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export function deleteGoal(id: string): boolean {
  const existing = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!existing) return false;

  db.delete(goals).where(eq(goals.id, id)).run();
  return true;
}

// ── Goal-Workflow Links ────────────────────────

export function linkWorkflowToGoal(
  goalId: string,
  templateId: string,
  contribution: "primary" | "supporting" = "primary"
): GoalWorkflow {
  const id = nanoid();
  db.insert(goalWorkflows).values({ id, goalId, templateId, contribution }).run();
  return db.select().from(goalWorkflows).where(eq(goalWorkflows.id, id)).get()!;
}

export function unlinkWorkflowFromGoal(id: string): boolean {
  const existing = db.select().from(goalWorkflows).where(eq(goalWorkflows.id, id)).get();
  if (!existing) return false;

  db.delete(goalWorkflows).where(eq(goalWorkflows.id, id)).run();
  return true;
}

export function listGoalWorkflows(
  goalId: string
): (GoalWorkflow & { templateName: string })[] {
  const rows = db
    .select({
      link: goalWorkflows,
      templateName: workflowTemplates.name,
    })
    .from(goalWorkflows)
    .innerJoin(workflowTemplates, eq(goalWorkflows.templateId, workflowTemplates.id))
    .where(eq(goalWorkflows.goalId, goalId))
    .all();

  return rows.map((r) => ({ ...r.link, templateName: r.templateName }));
}

// ── Progress Tracking ──────────────────────────

export function createGoalProgress(data: {
  goalId: string;
  value: number;
  delta: number;
  source?: string;
  note?: string;
}): GoalProgressType {
  const id = nanoid();
  db.insert(goalProgress).values({ ...data, id }).run();
  return db.select().from(goalProgress).where(eq(goalProgress.id, id)).get()!;
}

export function listGoalProgress(
  goalId: string,
  since?: number
): GoalProgressType[] {
  const effectiveSince =
    since ?? Math.floor(Date.now() / 1000) - 30 * 86400;
  const conditions: SQL[] = [
    eq(goalProgress.goalId, goalId),
    gte(goalProgress.snapshotAt, effectiveSince),
  ];

  return db
    .select()
    .from(goalProgress)
    .where(and(...conditions))
    .orderBy(desc(goalProgress.snapshotAt))
    .all();
}

// ── Auto-Progress (called from agent runner) ───

/**
 * Compute delta from workflow completion and update linked goals.
 * Called passively after any template-driven workflow completes.
 */
export function updateGoalProgressFromWorkflow(
  templateId: string,
  runId: string,
  workflowType: string,
  resultData: Record<string, unknown>
): void {
  // Find all goals linked to this template
  const links = db
    .select({ goalId: goalWorkflows.goalId })
    .from(goalWorkflows)
    .where(eq(goalWorkflows.templateId, templateId))
    .all();

  if (links.length === 0) return;

  for (const { goalId } of links) {
    const goal = db.select().from(goals).where(eq(goals.id, goalId)).get();
    if (!goal || goal.status !== "active") continue;

    const delta = computeDelta(goal, workflowType, runId, resultData);
    if (delta === 0) continue;

    const newValue = goal.currentValue + delta;

    // Update goal's current value
    const updates: Partial<Goal> = {
      currentValue: newValue,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    // Auto-achieve if target met
    if (newValue >= goal.targetValue) {
      updates.status = "achieved";
    }

    db.update(goals).set(updates).where(eq(goals.id, goalId)).run();

    // Create progress snapshot
    createGoalProgress({
      goalId,
      value: newValue,
      delta,
      source: runId,
      note: `Auto-tracked from ${workflowType} workflow`,
    });
  }
}

/**
 * Compute delta based on goal type and workflow type.
 * Uses workflow step data and result JSON to determine contribution.
 */
function computeDelta(
  goal: Goal,
  workflowType: string,
  runId: string,
  resultData: Record<string, unknown>
): number {
  switch (goal.goalType) {
    case "lead_generation": {
      if (workflowType === "search") {
        // Count contact_create steps with status "completed"
        const created = db
          .select({ value: count() })
          .from(workflowSteps)
          .where(
            and(
              eq(workflowSteps.workflowRunId, runId),
              eq(workflowSteps.stepType, "contact_create"),
              eq(workflowSteps.status, "completed")
            )
          )
          .get()?.value ?? 0;
        return created;
      }
      if (workflowType === "enrich") {
        // Count contacts that were enriched (any completed enrich step)
        const enriched = db
          .select({ value: count() })
          .from(workflowSteps)
          .where(
            and(
              eq(workflowSteps.workflowRunId, runId),
              eq(workflowSteps.stepType, "contact_merge"),
              eq(workflowSteps.status, "completed")
            )
          )
          .get()?.value ?? 0;
        return enriched;
      }
      return 0;
    }

    case "audience_growth": {
      // Extract follower delta from result data if available
      const followerDelta = typeof resultData.followerDelta === "number"
        ? resultData.followerDelta
        : 0;
      if (followerDelta > 0) return followerDelta;

      // Fallback: count new contacts created
      if (workflowType === "search") {
        return db
          .select({ value: count() })
          .from(workflowSteps)
          .where(
            and(
              eq(workflowSteps.workflowRunId, runId),
              eq(workflowSteps.stepType, "contact_create"),
              eq(workflowSteps.status, "completed")
            )
          )
          .get()?.value ?? 0;
      }
      return 0;
    }

    case "content_engagement": {
      // Count published content steps
      const published = db
        .select({ value: count() })
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.workflowRunId, runId),
            eq(workflowSteps.stepType, "content_publish"),
            eq(workflowSteps.status, "completed")
          )
        )
        .get()?.value ?? 0;
      if (published > 0) return published;

      // Fallback: count engagement actions
      const engagements = db
        .select({ value: count() })
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.workflowRunId, runId),
            eq(workflowSteps.stepType, "post_engagement"),
            eq(workflowSteps.status, "completed")
          )
        )
        .get()?.value ?? 0;
      return engagements;
    }

    case "pipeline_progression": {
      // Count contacts moved to a higher funnel stage
      // Approximated by counting completed contact_merge steps
      return db
        .select({ value: count() })
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.workflowRunId, runId),
            eq(workflowSteps.stepType, "contact_merge"),
            eq(workflowSteps.status, "completed")
          )
        )
        .get()?.value ?? 0;
    }

    default:
      return 0;
  }
}
