import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/contacts/[id]/dispatch-goal-tactic/route";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { listTasks } from "@/lib/db/queries/tasks";
import { upsertPersona } from "@/lib/db/queries/personas";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  runTemplateViaRtx: vi.fn(async () => ({
    success: true,
    workflowRunId: "run-test-123",
    threadPath: "Signals/Contact Relationship Nurture",
  })),
}));

describe("POST /api/contacts/[id]/dispatch-goal-tactic", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns 404 for non-existent contact", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/contacts/non-existent/dispatch-goal-tactic", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "non-existent" }) });
    expect(res.status).toBe(404);
  });

  it("creates an agent task and dispatches to RealTimeX", async () => {
    const contact = createContact({
      name: "Tejas Kumar",
      relationshipGoal: "follow_back",
      relationshipGoalStatus: "not_started",
    });

    upsertPersona({
      contactId: contact.id,
      archetype: "Creator Digital Marketer",
      tone: "Casual and supportive",
      summary: "Creator behind Yourmove.lol",
      interests: ["Gaming", "Community Management"],
      conversionTriggers: ["Featured content opportunities"],
      engagementFormats: ["Short-form video", "X (Twitter) posts"],
    });

    const req = new NextRequest(`http://127.0.0.1:3000/api/contacts/${contact.id}/dispatch-goal-tactic`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: contact.id }) });
    const json = await res.json();
    if (res.status !== 201) {
      console.error("DEBUG ERROR:", json);
    }
    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.taskId).toBeDefined();
    expect(json.threadName).toBe("Contact Relationship Nurture");
    expect(json.tactic.goal).toBe("follow_back");

    // Verify task in CRM
    const tasks = listTasks({ assignee: "agent" });
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.relatedContactId).toBe(contact.id);
    expect(tasks[0]!.priority).toBe("high");
    expect(tasks[0]!.status).toBe("todo");
    expect(tasks[0]!.title).toContain("Follow-Back");

    // Verify contact updated to in_progress
    const updatedContact = getContactById(contact.id);
    expect(updatedContact?.relationshipGoalStatus).toBe("in_progress");
  });

  it("accepts goal override in request body", async () => {
    const contact = createContact({
      name: "Alex Rivera",
      relationshipGoal: "follow_back",
    });

    const req = new NextRequest(`http://127.0.0.1:3000/api/contacts/${contact.id}/dispatch-goal-tactic`, {
      method: "POST",
      body: JSON.stringify({ goal: "partnership" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: contact.id }) });
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.tactic.goal).toBe("partnership");
  });
});
