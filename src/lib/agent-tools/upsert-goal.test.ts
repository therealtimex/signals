import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as invokeRoute } from "@/app/api/agent-tools/invoke/route";
import { POST as dashboardCreate } from "@/app/api/goals/route";
import { PUT as dashboardUpdate } from "@/app/api/goals/[id]/route";
import { db } from "@/lib/db/client";
import { goalProgress, goals, graphEdges } from "@/lib/db/schema";
import { linkWorkflowToGoal, updateGoalProgressFromWorkflow } from "@/lib/db/queries/goals";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { resetCoreTables } from "@/test/db";

// #565: upsert_goal creates or updates a goal with the existing fields, links it to a niche
// (`targets`, goal → niche) and launches (`contributes_to`, launch → goal), and the reads report
// progress the way the dashboard does. Links don't move progress (Option A).

async function invoke(tool: string, input: object) {
  const response = await invokeRoute(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function ok(tool: string, input: object) {
  const { status, body } = await invoke(tool, input);
  expect(status, `${tool}: ${JSON.stringify(body)}`).toBe(200);
  return body.result;
}

async function fails(tool: string, input: object, code: string) {
  const { status, body } = await invoke(tool, input);
  expect(body.success, JSON.stringify(body)).toBe(false);
  expect(body.code, JSON.stringify(body)).toBe(code);
  return { status, body };
}

/** The dashboard's create and edit forms, through their own routes. */
async function dashboardPost(body: object) {
  const response = await dashboardCreate(
    new NextRequest("http://localhost/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(201);
  return response.json();
}

async function dashboardPut(id: string, body: object) {
  const response = await dashboardUpdate(
    new NextRequest(`http://localhost/api/goals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  return response.json();
}

const goalRows = () => db.select().from(goals).all();
const edgeRows = () => db.select().from(graphEdges).all();

async function niche(name = "HackwithBay 4.0") {
  return (await ok("upsert_niche", { name, nicheType: "custom" })).id as string;
}

async function launch(name = "HackwithBay follow-up") {
  return (await ok("upsert_launch", { name })).id as string;
}

const customerGoal = {
  name: "Book 10 meetings from HackwithBay 4.0",
  goalType: "pipeline_progression",
  targetValue: 10,
  unit: "meetings",
};

describe("upsert_goal (#565)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a goal linked to a niche, then updates its progress by id", async () => {
    const nicheId = await niche();
    const created = await ok("upsert_goal", { ...customerGoal, nicheId });
    expect(created).toMatchObject({
      name: customerGoal.name,
      goalType: "pipeline_progression",
      targetValue: 10,
      currentValue: 0,
      unit: "meetings",
      status: "active",
      platform: null,
      deadline: null,
      progressPct: 0,
      nicheIds: [nicheId],
      launchIds: [],
      created: true,
      matchedBy: null,
    });
    expect(created.note).toBeUndefined();
    expect(edgeRows()).toEqual([
      expect.objectContaining({ srcType: "goal", srcId: created.id, dstType: "niche", dstId: nicheId, edgeType: "targets" }),
    ]);

    const updated = await ok("upsert_goal", { id: created.id, currentValue: 3 });
    expect(updated).toMatchObject({
      id: created.id,
      currentValue: 3,
      progressPct: 30,
      created: false,
      matchedBy: "id",
      nicheIds: [nicheId],
    });
    expect(goalRows()).toHaveLength(1);
  });

  it("keeps omitted fields on update instead of clearing them", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
    const goal = await ok("upsert_goal", { ...customerGoal, platform: "linkedin", deadline, currentValue: 2 });
    await ok("upsert_goal", { id: goal.id, targetValue: 12 });
    expect(goalRows()[0]).toMatchObject({
      name: customerGoal.name,
      goalType: "pipeline_progression",
      targetValue: 12,
      currentValue: 2,
      unit: "meetings",
      platform: "linkedin",
      deadline,
      status: "active",
    });

    // An explicit null clears a nullable field.
    await ok("upsert_goal", { id: goal.id, platform: null, deadline: null });
    expect(goalRows()[0]).toMatchObject({ platform: null, deadline: null, targetValue: 12 });
  });

  it("returns NOT_FOUND for an unknown id and writes nothing", async () => {
    const nicheId = await niche();
    const { status } = await fails("upsert_goal", { id: "no-such-goal", ...customerGoal, nicheId }, "NOT_FOUND");
    expect(status).toBe(404);
    expect(goalRows()).toHaveLength(0);
    expect(edgeRows()).toHaveLength(0);
  });

  describe("natural key", () => {
    it("lands a retry on the same goal: name trimmed and case-insensitive, same goalType", async () => {
      const first = await ok("upsert_goal", customerGoal);
      const retry = await ok("upsert_goal", {
        ...customerGoal,
        name: "  book 10 MEETINGS from hackwithbay 4.0 ",
        currentValue: 4,
      });
      expect(retry).toMatchObject({ id: first.id, created: false, matchedBy: "natural_key", currentValue: 4 });
      expect(retry.note).toBeUndefined();
      expect(goalRows()).toHaveLength(1);
      // The matched goal is renamed to the name sent, like any other provided field.
      expect(goalRows()[0]!.name).toBe("book 10 MEETINGS from hackwithbay 4.0");
    });

    it("matches without targetValue or unit, so a progress-only retry needs no create fields", async () => {
      const first = await ok("upsert_goal", customerGoal);
      const progress = await ok("upsert_goal", { name: customerGoal.name, goalType: customerGoal.goalType, currentValue: 5 });
      expect(progress).toMatchObject({ id: first.id, currentValue: 5, targetValue: 10, matchedBy: "natural_key" });
    });

    it("matches paused goals but not achieved or missed ones, nor another goalType", async () => {
      const paused = await ok("upsert_goal", { ...customerGoal, status: "paused" });
      expect((await ok("upsert_goal", customerGoal)).id).toBe(paused.id);

      await ok("upsert_goal", { id: paused.id, status: "achieved" });
      const afterAchieved = await ok("upsert_goal", customerGoal);
      expect(afterAchieved).toMatchObject({ created: true, matchedBy: null });
      expect(afterAchieved.id).not.toBe(paused.id);

      await ok("upsert_goal", { id: afterAchieved.id, status: "missed" });
      expect((await ok("upsert_goal", customerGoal)).created).toBe(true);

      const otherType = await ok("upsert_goal", { ...customerGoal, goalType: "lead_generation" });
      expect(otherType.created).toBe(true);
      expect(goalRows()).toHaveLength(4);
    });

    it("updates the newest of several open same-name goals and says so in a note", async () => {
      const older = await dashboardPost(customerGoal);
      const newer = await dashboardPost({ ...customerGoal, name: customerGoal.name.toUpperCase() });
      const result = await ok("upsert_goal", { ...customerGoal, currentValue: 1 });
      expect(result).toMatchObject({ id: newer.id, created: false, matchedBy: "natural_key", currentValue: 1 });
      expect(result.note).toContain("2 open pipeline_progression goals");
      expect(result.note).toContain(`updated the newest (${newer.id})`);
      expect(result.note).toContain(older.id);
      expect(goalRows().find((g) => g.id === older.id)!.currentValue).toBe(0);
      expect(goalRows()).toHaveLength(2);
    });
  });

  describe("validation", () => {
    const invalid: Array<[string, object]> = [
      ["unknown goalType", { ...customerGoal, goalType: "meetings_booked" }],
      ["targetValue 0", { ...customerGoal, targetValue: 0 }],
      ["negative targetValue", { ...customerGoal, targetValue: -5 }],
      ["fractional targetValue", { ...customerGoal, targetValue: 2.5 }],
      ["negative currentValue", { ...customerGoal, currentValue: -1 }],
      ["fractional currentValue", { ...customerGoal, currentValue: 1.5 }],
      ["blank unit", { ...customerGoal, unit: "  " }],
      ["unknown status", { ...customerGoal, status: "archived" }],
      ["unknown platform", { ...customerGoal, platform: "facebook" }],
      ["fractional deadline", { ...customerGoal, deadline: 1.5 }],
      ["blank name", { ...customerGoal, name: "   " }],
      ["no id, no name", { goalType: "pipeline_progression", targetValue: 10, unit: "meetings" }],
      ["no id, no goalType", { name: "Goal", targetValue: 10, unit: "meetings" }],
    ];
    it.each(invalid)("rejects %s and writes nothing", async (_label, input) => {
      const { status } = await fails("upsert_goal", input, "VALIDATION_ERROR");
      expect(status).toBe(400);
      expect(goalRows()).toHaveLength(0);
    });

    it.each([["targetValue"], ["unit"]] as const)("requires %s to create", async (field) => {
      const input: Record<string, unknown> = { ...customerGoal };
      delete input[field];
      const { body } = await fails("upsert_goal", input, "VALIDATION_ERROR");
      expect(body.error).toContain(`requires ${field}`);
      expect(body.details).toEqual({ missing: [field] });
      expect(goalRows()).toHaveLength(0);
    });

    it("rejects invalid values on update too, leaving the goal unchanged", async () => {
      const goal = await ok("upsert_goal", customerGoal);
      await fails("upsert_goal", { id: goal.id, currentValue: -2 }, "VALIDATION_ERROR");
      await fails("upsert_goal", { id: goal.id, targetValue: 0 }, "VALIDATION_ERROR");
      expect(goalRows()[0]).toMatchObject({ currentValue: 0, targetValue: 10 });
    });

    it("allows a past deadline, as the dashboard does", async () => {
      const deadline = Math.floor(Date.now() / 1000) - 86400;
      expect(await ok("upsert_goal", { ...customerGoal, deadline })).toMatchObject({ deadline, status: "active" });
    });

    it("returns NOT_FOUND for a missing niche or launch before any write", async () => {
      await fails("upsert_goal", { ...customerGoal, nicheId: "no-such-niche" }, "NOT_FOUND");
      await fails("upsert_goal", { ...customerGoal, launchId: "no-such-launch" }, "NOT_FOUND");
      expect(goalRows()).toHaveLength(0);
      expect(edgeRows()).toHaveLength(0);

      // On update, the goal's fields are not written either.
      const goal = await ok("upsert_goal", customerGoal);
      await fails("upsert_goal", { id: goal.id, currentValue: 7, nicheId: "no-such-niche" }, "NOT_FOUND");
      await fails("upsert_goal", { id: goal.id, currentValue: 7, launchId: "no-such-launch" }, "NOT_FOUND");
      expect(goalRows()[0]!.currentValue).toBe(0);
      expect(edgeRows()).toHaveLength(0);
    });
  });

  describe("links", () => {
    it("re-linking is a no-op; a different niche replaces the link; null removes it", async () => {
      const first = await niche("HackwithBay 4.0");
      const second = await niche("HackwithBay 5.0");
      const goal = await ok("upsert_goal", { ...customerGoal, nicheId: first });
      const [edge] = edgeRows();

      await ok("upsert_goal", { ...customerGoal, nicheId: first });
      expect(edgeRows()).toEqual([expect.objectContaining({ id: edge!.id, dstId: first })]);

      // Omitting nicheId leaves the link alone.
      expect((await ok("upsert_goal", { id: goal.id, currentValue: 1 })).nicheIds).toEqual([first]);

      expect((await ok("upsert_goal", { id: goal.id, nicheId: second })).nicheIds).toEqual([second]);
      expect(edgeRows()).toEqual([expect.objectContaining({ edgeType: "targets", dstId: second })]);

      expect((await ok("upsert_goal", { id: goal.id, nicheId: null })).nicheIds).toEqual([]);
      expect(edgeRows()).toHaveLength(0);
    });

    it("adds launch links launch → goal, once per launch", async () => {
      const a = await launch("Launch A");
      const b = await launch("Launch B");
      const goal = await ok("upsert_goal", { ...customerGoal, launchId: a });
      await ok("upsert_goal", { id: goal.id, launchId: a });
      const result = await ok("upsert_goal", { id: goal.id, launchId: b });
      expect(result.launchIds).toEqual([a, b]);
      const launchEdges = edgeRows().filter((e) => e.edgeType === "contributes_to");
      expect(launchEdges).toHaveLength(2);
      expect(launchEdges.every((e) => e.srcType === "launch" && e.dstType === "goal" && e.dstId === goal.id)).toBe(true);

      // The launch's own read already follows contributes_to edges to goals.
      const launchDetail = await ok("query_launches", { id: a });
      expect(JSON.stringify(launchDetail)).toContain(goal.id);
    });

    it("does not change progress: linking a niche with members leaves currentValue alone", async () => {
      const nicheId = await niche();
      const member = await ok("create_contact", { name: "Cohort Member", platform: "linkedin", platformUserId: "cohort-member" });
      await ok("upsert_edge", {
        srcType: "contact",
        srcId: member.id,
        dstType: "niche",
        dstId: nicheId,
        edgeType: "belongs_to_niche",
      });
      await ok("log_interaction", { contactId: member.id, interactionType: "meeting", summary: "Intro call" });
      const goal = await ok("upsert_goal", { ...customerGoal, nicheId });
      expect(goal).toMatchObject({ currentValue: 0, progressPct: 0 });
      expect((await ok("query_goals", {})).goals[0]).toMatchObject({ currentValue: 0, progressPct: 0 });
    });

    it("reads a goal → niche targets edge written by upsert_edge (the widened catalogue)", async () => {
      const nicheId = await niche();
      const goal = await ok("upsert_goal", customerGoal);
      await ok("upsert_edge", { srcType: "goal", srcId: goal.id, dstType: "niche", dstId: nicheId, edgeType: "targets" });
      expect((await ok("query_goals", {})).goals[0].nicheIds).toEqual([nicheId]);
      // upsert_goal then treats it as the goal's single niche link.
      await ok("upsert_goal", { id: goal.id, nicheId: null });
      expect(edgeRows()).toHaveLength(0);
    });
  });

  describe("status follows the dashboard's manual path", () => {
    it("reaching the target leaves an active goal active, exactly like the dashboard's ±", async () => {
      const viaTool = await ok("upsert_goal", customerGoal);
      const viaDashboard = await dashboardPost({ ...customerGoal, name: "Dashboard goal" });

      const toolResult = await ok("upsert_goal", { id: viaTool.id, currentValue: 10 });
      const dashboardResult = await dashboardPut(viaDashboard.id, { currentValue: 10 });
      expect(toolResult.status).toBe("active");
      expect(dashboardResult.status).toBe("active");
      expect(toolResult.progressPct).toBe(100);

      // An explicit status is how either path marks it achieved.
      expect((await ok("upsert_goal", { id: viaTool.id, status: "achieved" })).status).toBe("achieved");
    });

    it("differs from the workflow mover, which auto-achieves at the target", async () => {
      // Pinned so a change to either mover is noticed: the workflow path achieves (and writes a
      // snapshot); the manual paths, dashboard ± and upsert_goal, do neither.
      const template = createTemplate({ name: "Follower sync", templateType: "prospecting", status: "active", config: "{}" });
      const viaWorkflow = await ok("upsert_goal", { ...customerGoal, name: "Workflow", goalType: "audience_growth", targetValue: 5, unit: "followers" });
      const viaTool = await ok("upsert_goal", { ...customerGoal, name: "Tool", goalType: "audience_growth", targetValue: 5, unit: "followers" });
      linkWorkflowToGoal(viaWorkflow.id, template.id);
      updateGoalProgressFromWorkflow(template.id, "run-1", "sync", { followerDelta: 5 });
      await ok("upsert_goal", { id: viaTool.id, currentValue: 5 });

      const byId = new Map(goalRows().map((g) => [g.id, g]));
      expect(byId.get(viaWorkflow.id)).toMatchObject({ currentValue: 5, status: "achieved" });
      expect(byId.get(viaTool.id)).toMatchObject({ currentValue: 5, status: "active" });
      expect(db.select().from(goalProgress).where(eq(goalProgress.goalId, viaTool.id)).all()).toHaveLength(0);
      expect(db.select().from(goalProgress).where(eq(goalProgress.goalId, viaWorkflow.id)).all()).toHaveLength(1);
    });
  });

  describe("reads", () => {
    it("query_goals reports the dashboard's progressPct for a dashboard-created goal, plus links", async () => {
      const nicheId = await niche();
      const launchId = await launch();
      const goal = await dashboardPost({ ...customerGoal, targetValue: 9 });
      await dashboardPut(goal.id, { currentValue: 7 });
      await ok("upsert_goal", { id: goal.id, nicheId, launchId });

      const [row] = (await ok("query_goals", {})).goals;
      // Dashboard: min(100, round(7 / 9 * 100)) = 78.
      expect(row).toMatchObject({ id: goal.id, currentValue: 7, targetValue: 9, progressPct: 78, nicheIds: [nicheId], launchIds: [launchId] });

      await dashboardPut(goal.id, { currentValue: 12 });
      expect((await ok("query_goals", {})).goals[0].progressPct).toBe(100);
    });

    it("query_goals gives unlinked goals empty link lists", async () => {
      await dashboardPost(customerGoal);
      expect((await ok("query_goals", {})).goals[0]).toMatchObject({ progressPct: 0, nicheIds: [], launchIds: [] });
    });

    it("query_analytics adds a goals section: counts by status and active goals by deadline", async () => {
      const empty = await ok("query_analytics", {});
      expect(empty.goals).toEqual({ total: 0, byStatus: { active: 0, achieved: 0, missed: 0, paused: 0 }, active: [] });
      expect(empty).toHaveProperty("totalContacts");

      const now = Math.floor(Date.now() / 1000);
      const later = await ok("upsert_goal", { ...customerGoal, name: "Later", deadline: now + 7200, currentValue: 3 });
      const sooner = await ok("upsert_goal", { ...customerGoal, name: "Sooner", deadline: now + 3600, targetValue: 4, currentValue: 1 });
      const open = await ok("upsert_goal", { ...customerGoal, name: "No deadline" });
      await ok("upsert_goal", { ...customerGoal, name: "Paused", status: "paused" });
      await ok("upsert_goal", { ...customerGoal, name: "Done", status: "achieved" });

      const { goals: summary } = await ok("query_analytics", {});
      expect(summary.total).toBe(5);
      expect(summary.byStatus).toEqual({ active: 3, achieved: 1, missed: 0, paused: 1 });
      expect(summary.active.map((g: { id: string }) => g.id)).toEqual([sooner.id, later.id, open.id]);
      expect(summary.active[0]).toEqual({
        id: sooner.id,
        name: "Sooner",
        goalType: "pipeline_progression",
        currentValue: 1,
        targetValue: 4,
        unit: "meetings",
        progressPct: 25,
        deadline: now + 3600,
      });
      expect(summary.active[1]).toMatchObject({ progressPct: 30 });
    });
  });
});
