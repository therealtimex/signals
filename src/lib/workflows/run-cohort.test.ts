import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import {
  parseStoredCohort,
  recordRunCohort,
  resolveRunCohort,
  RunCohortError,
  unionCohort,
} from "@/lib/workflows/run-cohort";
import { resetCoreTables } from "@/test/db";

describe("workflow run cohorts", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("normalizes malformed stored values and preserves union order", () => {
    expect(parseStoredCohort("not json")).toEqual([]);
    expect(parseStoredCohort(JSON.stringify({ createdContactIds: [" a ", 2, "", "a", "b"] })))
      .toEqual(["a", "b"]);
    expect(unionCohort(["b", "a"], ["a", "c", " "])).toEqual(["b", "a", "c"]);
  });

  it("records new and existing contacts idempotently without changing birth provenance", () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ retained: true }),
    });
    const existing = createContact({ name: "Existing" });
    const created = createContact(
      { name: "Created" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );

    const first = recordRunCohort({
      runId: run.id,
      templateId: template.id,
      contactIds: [created.id, existing.id, created.id],
    });
    expect(first).toMatchObject({
      runId: run.id,
      templateId: template.id,
      cohortSize: 2,
      addedContactIds: [created.id, existing.id],
      alreadyRecorded: 0,
      processedItems: 2,
    });

    const stored = getWorkflowRun(run.id)!;
    expect(JSON.parse(stored.result ?? "{}")).toEqual({
      retained: true,
      createdContactIds: [created.id, existing.id],
    });
    expect(existing.createdWorkflowRunId).toBeNull();
    expect(existing.createdTemplateId).toBeNull();
    expect(created.createdWorkflowRunId).toBe(run.id);
    expect(created.createdTemplateId).toBe(template.id);

    db.update(workflowRuns).set({ updatedAt: 1 }).where(eq(workflowRuns.id, run.id)).run();
    const second = recordRunCohort({
      runId: run.id,
      templateId: template.id,
      contactIds: [created.id, existing.id],
    });
    expect(second).toMatchObject({
      cohortSize: 2,
      addedContactIds: [],
      alreadyRecorded: 2,
      processedItems: 2,
    });
    expect(getWorkflowRun(run.id)?.updatedAt).toBe(1);
  });

  it("validates run, template, and every contact before writing", () => {
    const template = createTemplate({ name: "Primary", templateType: "prospecting", status: "active" });
    const other = createTemplate({ name: "Other", templateType: "prospecting", status: "active" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ retained: true }),
    });

    expect(() => recordRunCohort({ runId: "missing" })).toThrowError(RunCohortError);
    expect(() => recordRunCohort({ runId: run.id, templateId: other.id })).toThrow(
      `templateId ${other.id} does not match workflow run ${run.id}`,
    );
    expect(() => recordRunCohort({ runId: run.id, contactIds: ["missing-contact"] })).toThrow(
      "Unknown contact IDs: missing-contact",
    );
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toEqual({ retained: true });
  });

  it("unions explicit, stored, and birth IDs before using config as a last resort", () => {
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ createdContactIds: ["stored", "shared"] }),
      config: JSON.stringify({ targetContactIds: ["config"] }),
    });
    const birth = createContact(
      { name: "Birth" },
      { tag: "agent:create_contact", workflowRunId: run.id },
    );

    expect(resolveRunCohort(run, ["explicit", "shared"])).toEqual({
      contactIds: ["explicit", "shared", "stored", birth.id],
      sources: ["explicit", "stored", "birth"],
    });

    const fallbackRun = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: "malformed",
      config: JSON.stringify({ targetContactIds: ["config", "config", 3] }),
    });
    expect(resolveRunCohort(fallbackRun)).toEqual({
      contactIds: ["config"],
      sources: ["config"],
    });
  });
});
