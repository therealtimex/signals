import { beforeEach, describe, it, expect, vi, afterEach } from "vitest";
import {
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  deleteGoal,
  createGoalProgress,
  listGoalProgress,
  linkWorkflowToGoal,
  updateGoalProgressFromWorkflow,
} from "@/lib/db/queries/goals";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowSteps } from "@/lib/db/schema";
import { nanoid } from "nanoid";

describe("goals queries", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and fetches a goal", () => {
    const goal = createGoal({
      name: "Grow audience",
      goalType: "audience_growth",
      platform: "x",
      targetValue: 1000,
      currentValue: 0,
      unit: "followers",
      status: "active",
      deadline: null,
    });

    const fetched = getGoal(goal.id);
    expect(fetched?.name).toBe("Grow audience");
    expect(fetched?.linkedWorkflows).toEqual([]);
    expect(fetched?.latestProgress).toBeNull();
  });

  it("filters goals by status", () => {
    createGoal({
      name: "Active goal",
      goalType: "lead_generation",
      platform: null,
      targetValue: 10,
      currentValue: 0,
      unit: "contacts",
      status: "active",
      deadline: null,
    });
    createGoal({
      name: "Paused goal",
      goalType: "lead_generation",
      platform: null,
      targetValue: 10,
      currentValue: 0,
      unit: "contacts",
      status: "paused",
      deadline: null,
    });

    const active = listGoals({ status: "active" });
    expect(active.total).toBe(1);
    expect(active.data[0]?.name).toBe("Active goal");
  });

  it("updates goal progress fields", () => {
    const goal = createGoal({
      name: "Pipeline",
      goalType: "pipeline_progression",
      platform: "linkedin",
      targetValue: 5,
      currentValue: 1,
      unit: "deals",
      status: "active",
      deadline: null,
    });

    const updated = updateGoal(goal.id, { currentValue: 3 });
    expect(updated?.currentValue).toBe(3);
  });

  it("records progress snapshots and lists recent history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const goal = createGoal({
      name: "Engagement",
      goalType: "content_engagement",
      platform: "x",
      targetValue: 100,
      currentValue: 0,
      unit: "engagements",
      status: "active",
      deadline: null,
    });

    createGoalProgress({
      goalId: goal.id,
      value: 10,
      delta: 10,
      source: "manual",
    });

    vi.setSystemTime(new Date("2026-02-02T00:00:00Z"));
    createGoalProgress({
      goalId: goal.id,
      value: 25,
      delta: 15,
      source: "manual",
    });

    const history = listGoalProgress(goal.id);
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.value).sort((a, b) => a - b)).toEqual([10, 25]);
  });

  it("links a workflow template to a goal", () => {
    const goal = createGoal({
      name: "Leads",
      goalType: "lead_generation",
      platform: "x",
      targetValue: 50,
      currentValue: 0,
      unit: "contacts",
      status: "active",
      deadline: null,
    });

    const template = createTemplate({
      name: "Search prospects",
      description: null,
      platform: "x",
      templateType: "prospecting",
      status: "active",
      config: "{}",
      goalMetrics: "{}",
      startsAt: null,
      endsAt: null,
      systemPrompt: null,
      targetPersona: null,
      estimatedCost: 0,
      totalRuns: 0,
      lastRunAt: null,
      isSystem: 0,
      sourceTemplateId: null,
    });

    linkWorkflowToGoal(goal.id, template.id, "primary");

    const fetched = getGoal(goal.id);
    expect(fetched?.linkedWorkflows).toHaveLength(1);
    expect(fetched?.linkedWorkflows[0]?.templateName).toBe("Search prospects");
  });

  it("auto-updates linked goals from completed workflow steps", () => {
    const goal = createGoal({
      name: "Leads",
      goalType: "lead_generation",
      platform: "x",
      targetValue: 10,
      currentValue: 0,
      unit: "contacts",
      status: "active",
      deadline: null,
    });

    const template = createTemplate({
      name: "Prospect search",
      description: null,
      platform: "x",
      templateType: "prospecting",
      status: "active",
      config: "{}",
      goalMetrics: "{}",
      startsAt: null,
      endsAt: null,
      systemPrompt: null,
      targetPersona: null,
      estimatedCost: 0,
      totalRuns: 0,
      lastRunAt: null,
      isSystem: 0,
      sourceTemplateId: null,
    });

    linkWorkflowToGoal(goal.id, template.id, "primary");

    const runId = nanoid();
    db.insert(workflowRuns)
      .values({
        id: runId,
        templateId: template.id,
        workflowType: "search",
        status: "completed",
        totalItems: 1,
        processedItems: 1,
        successItems: 1,
        skippedItems: 0,
        errorItems: 0,
        startedAt: 1,
        completedAt: 2,
      })
      .run();

    db.insert(workflowSteps)
      .values({
        id: nanoid(),
        workflowRunId: runId,
        stepIndex: 0,
        stepType: "contact_create",
        status: "completed",
      })
      .run();

    updateGoalProgressFromWorkflow(template.id, runId, "search", {});

    const updated = getGoal(goal.id);
    expect(updated?.currentValue).toBe(1);
    expect(updated?.latestProgress?.delta).toBe(1);
  });

  it("deletes a goal", () => {
    const goal = createGoal({
      name: "Temporary",
      goalType: "lead_generation",
      platform: "x",
      targetValue: 1,
      currentValue: 0,
      unit: "contacts",
      status: "active",
      deadline: null,
    });

    expect(deleteGoal(goal.id)).toBe(true);
    expect(getGoal(goal.id)).toBeUndefined();
  });
});
