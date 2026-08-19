import { describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  extractWorkflowRunSubjectIds,
  resolveWorkflowRunSubjects,
  resolveWorkflowRunSubjectsForDetail,
} from "@/lib/workflows/workflow-run-subjects";
import { createWorkflowStep } from "@/lib/db/queries/workflows";

describe("workflow-run-subjects", () => {
  it("extracts contact and organization ids from run config", () => {
    const run = createWorkflowRun({
      workflowType: "enrich",
      status: "completed",
      config: JSON.stringify({
        selectedContactIds: ["c-1", "c-2"],
        orgId: "org-1",
      }),
      trigger: "template",
    });

    expect(extractWorkflowRunSubjectIds(run)).toEqual({
      contactIds: ["c-1", "c-2"],
      orgIds: ["org-1"],
    });
  });

  it("resolves subject labels and hrefs for list display", () => {
    resetCoreTables();
    const contact = createContact({ name: "Ada Lovelace", platform: "x", platformUserId: "ada" });
    const org = createOrg({ name: "Analytical Engines Ltd" });
    const run = createWorkflowRun({
      workflowType: "persona",
      status: "completed",
      config: JSON.stringify({ contactId: contact.id, orgId: org.id }),
      trigger: "user",
    });

    const subjects = resolveWorkflowRunSubjects([run])[run.id];
    expect(subjects).toEqual([
      {
        kind: "contact",
        id: contact.id,
        label: "Ada Lovelace",
        href: `/dashboard/contacts/${contact.id}`,
      },
      {
        kind: "organization",
        id: org.id,
        label: "Analytical Engines Ltd",
        href: `/dashboard/organizations/${org.id}`,
      },
    ]);
  });

  it("includes step contact ids when resolving detail subjects", () => {
    resetCoreTables();
    const contact = createContact({ name: "Grace Hopper", platform: "x", platformUserId: "grace" });
    const run = createWorkflowRun({
      workflowType: "enrich",
      status: "completed",
      config: JSON.stringify({ templateName: "Contact profile pipeline" }),
      trigger: "template",
    });
    createWorkflowStep({
      workflowRunId: run.id,
      stepIndex: 0,
      stepType: "tool_call",
      status: "completed",
      contactId: contact.id,
    });

    const subjects = resolveWorkflowRunSubjectsForDetail(run, [
      {
        id: "step-1",
        workflowRunId: run.id,
        stepIndex: 0,
        stepType: "tool_call",
        status: "completed",
        contactId: contact.id,
        url: null,
        tool: "enrich_contact_avatars",
        input: "{}",
        output: JSON.stringify({ contactId: contact.id, status: "skipped" }),
        error: null,
        durationMs: 0,
        createdAt: Math.floor(Date.now() / 1000),
      },
    ]);

    expect(subjects).toEqual([
      {
        kind: "contact",
        id: contact.id,
        label: "Grace Hopper",
        href: `/dashboard/contacts/${contact.id}`,
      },
    ]);
  });
});
