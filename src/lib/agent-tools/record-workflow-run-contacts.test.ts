import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { createContact, listContacts } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";

async function invokeTool(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

async function invoke(input: object) {
  return invokeTool("record_workflow_run_contacts", input);
}

describe("record_workflow_run_contacts", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("supports validate-only calls and durable cohort writes", async () => {
    const template = createTemplate({ name: "Snowball", templateType: "prospecting", status: "active" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
    });
    const first = createContact({ name: "First" });
    const second = createContact({ name: "Second" });

    const preflight = await invoke({ runId: run.id, templateId: template.id });
    expect(preflight.response.status).toBe(200);
    expect(preflight.body.result).toMatchObject({ cohortSize: 0, addedContactIds: [] });

    const recorded = await invoke({
      runId: run.id,
      templateId: template.id,
      contactIds: [first.id, second.id],
    });
    expect(recorded.response.status).toBe(200);
    expect(recorded.body.result).toMatchObject({
      runId: run.id,
      cohortSize: 2,
      addedContactIds: [first.id, second.id],
      processedItems: 2,
    });
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}").createdContactIds).toEqual([
      first.id,
      second.id,
    ]);

    const repeated = await invoke({
      runId: run.id,
      templateId: template.id,
      contactIds: [first.id, second.id],
    });
    expect(repeated.response.status).toBe(200);
    expect(repeated.body.result).toMatchObject({
      cohortSize: 2,
      addedContactIds: [],
      alreadyRecorded: 2,
      processedItems: 2,
    });
  });

  it("returns machine-readable errors without mutating the run", async () => {
    const template = createTemplate({ name: "Primary", templateType: "prospecting", status: "active" });
    const other = createTemplate({ name: "Other", templateType: "prospecting", status: "active" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ retained: true }),
    });

    const missing = await invoke({ runId: "missing-run" });
    expect(missing.response.status).toBe(404);
    expect(missing.body).toMatchObject({ success: false, code: "NOT_FOUND" });

    const missingTemplate = await invoke({ runId: run.id, templateId: "missing-template" });
    expect(missingTemplate.response.status).toBe(404);
    expect(missingTemplate.body).toMatchObject({
      success: false,
      code: "NOT_FOUND",
      error: "Workflow template missing-template not found",
    });

    const mismatch = await invoke({ runId: run.id, templateId: other.id });
    expect(mismatch.response.status).toBe(400);
    expect(mismatch.body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      error: expect.stringContaining("does not match workflow run"),
    });

    const unknown = await invoke({ runId: run.id, contactIds: ["missing-contact"] });
    expect(unknown.response.status).toBe(400);
    expect(unknown.body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      error: "Unknown contact IDs: missing-contact",
    });
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toEqual({ retained: true });
  });

  it("applies the shared run-template mismatch rule before contact creation", async () => {
    const template = createTemplate({ name: "Primary", templateType: "prospecting", status: "active" });
    const other = createTemplate({ name: "Other", templateType: "prospecting", status: "active" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
    });

    const rejected = await invokeTool("create_contact", {
      name: "Must Not Exist",
      workflowRunId: run.id,
      templateId: other.id,
    });

    expect(rejected.response.status).toBe(400);
    expect(rejected.body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      error: expect.stringContaining("does not match workflow run"),
    });
    expect(listContacts({ search: "Must Not Exist" }).total).toBe(0);
  });
});
