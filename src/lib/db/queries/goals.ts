import { eq, and, or, desc, count, SQL, gte, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  goals,
  goalWorkflows,
  goalProgress,
  graphEdges,
  workflowTemplates,
  workflowSteps,
} from "@/lib/db/schema";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import type {
  Goal,
  NewGoal,
  GoalWorkflow,
  GoalProgress as GoalProgressType,
  PaginatedResult,
} from "@/lib/db/types";

export const GOAL_TYPES = [
  "audience_growth",
  "lead_generation",
  "content_engagement",
  "pipeline_progression",
] as const;
export const GOAL_STATUSES = ["active", "achieved", "missed", "paused"] as const;

/**
 * Goal links (#565). Relationships only: neither edge moves `currentValue`, which changes only
 * through linked workflow templates (`updateGoalProgressFromWorkflow`) or a direct write (the
 * dashboard's manual ± and `upsert_goal`).
 *
 * - `targets` goal → niche: the cohort the goal is about. The spec catalogues `targets` for
 *   launch|variant sources; #565 widens it to goals. A goal targets at most one niche.
 * - `contributes_to` launch → goal: the catalogued launch link. A goal can have several.
 */
export const GOAL_NICHE_EDGE_TYPE = "targets";
export const GOAL_LAUNCH_EDGE_TYPE = "contributes_to";

/** The dashboard's progress figure (goals list and goal detail): whole percent, capped at 100. */
export function goalProgressPct(currentValue: number, targetValue: number): number {
  return targetValue > 0 ? Math.min(100, Math.round((currentValue / targetValue) * 100)) : 0;
}

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

export function getGoalRow(id: string): Goal | undefined {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

/**
 * Goals `upsert_goal` treats as the same goal when no `id` is given: same `goalType`, same
 * `name` after trimming and ignoring case, and still open (`active` or `paused`). Newest first.
 */
export function findGoalsByNaturalKey(name: string, goalType: Goal["goalType"]): Goal[] {
  const key = name.trim().toLowerCase();
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.goalType, goalType), inArray(goals.status, ["active", "paused"])))
    // createdAt is whole seconds; rowid orders goals created in the same second.
    .orderBy(desc(goals.createdAt), desc(sql`rowid`))
    .all()
    .filter((goal) => goal.name.trim().toLowerCase() === key);
}

export type GoalLinks = { nicheIds: string[]; launchIds: string[] };

export function listGoalLinks(goalIds: string[]): Map<string, GoalLinks> {
  const links = new Map<string, GoalLinks>(goalIds.map((id) => [id, { nicheIds: [], launchIds: [] }]));
  if (goalIds.length === 0) return links;
  const niches = db
    .select({ goalId: graphEdges.srcId, nicheId: graphEdges.dstId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, GOAL_NICHE_EDGE_TYPE),
        eq(graphEdges.srcType, "goal"),
        inArray(graphEdges.srcId, goalIds),
        eq(graphEdges.dstType, "niche"),
      ),
    )
    .orderBy(graphEdges.createdAt)
    .all();
  for (const row of niches) links.get(row.goalId)?.nicheIds.push(row.nicheId);
  const launches = db
    .select({ goalId: graphEdges.dstId, launchId: graphEdges.srcId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, GOAL_LAUNCH_EDGE_TYPE),
        eq(graphEdges.srcType, "launch"),
        eq(graphEdges.dstType, "goal"),
        inArray(graphEdges.dstId, goalIds),
      ),
    )
    .orderBy(graphEdges.createdAt)
    .all();
  for (const row of launches) links.get(row.goalId)?.launchIds.push(row.launchId);
  return links;
}

/**
 * Point the goal's `targets` edge at `nicheId`, removing any edge to another niche, or remove it
 * when `nicheId` is null. Re-linking the same niche keeps the existing edge.
 */
export function setGoalNiche(goalId: string, nicheId: string | null): void {
  const others = and(
    eq(graphEdges.edgeType, GOAL_NICHE_EDGE_TYPE),
    eq(graphEdges.srcType, "goal"),
    eq(graphEdges.srcId, goalId),
    eq(graphEdges.dstType, "niche"),
  );
  db.delete(graphEdges)
    .where(nicheId === null ? others : and(others, ne(graphEdges.dstId, nicheId)))
    .run();
  if (nicheId !== null) {
    upsertGraphEdge({
      srcType: "goal",
      srcId: goalId,
      dstType: "niche",
      dstId: nicheId,
      edgeType: GOAL_NICHE_EDGE_TYPE,
      source: "agent",
    });
  }
}

/** Add a `contributes_to` edge from the launch to the goal; an existing one is kept. */
export function linkLaunchToGoal(goalId: string, launchId: string): void {
  upsertGraphEdge({
    srcType: "launch",
    srcId: launchId,
    dstType: "goal",
    dstId: goalId,
    edgeType: GOAL_LAUNCH_EDGE_TYPE,
    source: "agent",
  });
}

export type GoalsSummary = {
  total: number;
  byStatus: Record<(typeof GOAL_STATUSES)[number], number>;
  active: Array<{
    id: string;
    name: string;
    goalType: Goal["goalType"];
    currentValue: number;
    targetValue: number;
    unit: string;
    progressPct: number;
    deadline: number | null;
  }>;
};

const SUMMARY_ACTIVE_LIMIT = 50;

/** Goal counts by status and the active goals' progress, soonest deadline first. */
export function summarizeGoals(): GoalsSummary {
  const byStatus = Object.fromEntries(GOAL_STATUSES.map((status) => [status, 0])) as GoalsSummary["byStatus"];
  const counts = db
    .select({ status: goals.status, value: count() })
    .from(goals)
    .groupBy(goals.status)
    .all();
  for (const row of counts) byStatus[row.status] = row.value;
  const active = db
    .select()
    .from(goals)
    .where(eq(goals.status, "active"))
    .all()
    .sort(
      (a, b) =>
        (a.deadline ?? Number.MAX_SAFE_INTEGER) - (b.deadline ?? Number.MAX_SAFE_INTEGER) ||
        b.createdAt - a.createdAt,
    )
    .slice(0, SUMMARY_ACTIVE_LIMIT)
    .map((goal) => ({
      id: goal.id,
      name: goal.name,
      goalType: goal.goalType,
      currentValue: goal.currentValue,
      targetValue: goal.targetValue,
      unit: goal.unit,
      progressPct: goalProgressPct(goal.currentValue, goal.targetValue),
      deadline: goal.deadline,
    }));
  return {
    total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    byStatus,
    active,
  };
}

/**
 * Delete a goal and every graph edge touching it (#565): its `targets` niche link, launches'
 * `contributes_to` edges and any other edge an agent wrote. `graph_edges` has no foreign keys,
 * so without this the edges would outlive the goal as `missing_endpoint` integrity issues and
 * `query_launches` would keep listing the goal. Workflow links and progress rows cascade.
 */
export function deleteGoal(id: string): boolean {
  return db.transaction(() => {
    const existing = db.select().from(goals).where(eq(goals.id, id)).get();
    if (!existing) return false;

    db.delete(graphEdges)
      .where(
        or(
          and(eq(graphEdges.srcType, "goal"), eq(graphEdges.srcId, id)),
          and(eq(graphEdges.dstType, "goal"), eq(graphEdges.dstId, id)),
        ),
      )
      .run();
    db.delete(goals).where(eq(goals.id, id)).run();
    return true;
  });
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
