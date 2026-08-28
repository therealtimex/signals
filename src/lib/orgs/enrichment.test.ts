import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { getOrgEnrichmentState } from "@/lib/orgs/enrichment";
import { resetCoreTables } from "@/test/db";

describe("company profile enrichment", () => {
  beforeEach(() => resetCoreTables());

  it("seeds the agent template and derives pending and partial states", () => {
    seedTemplates();
    const template = getSystemTemplateByName(COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME);
    expect(template).toMatchObject({ templateType: "enrichment", isSystem: 1 });
    expect(JSON.parse(template!.config ?? "{}")).toMatchObject({
      companyEnrichment: { version: 1 },
      acceptsOrgId: true,
    });

    const run = createWorkflowRun({
      templateId: template!.id,
      workflowType: "enrich",
      status: "running",
      config: JSON.stringify({ orgId: "org-1" }),
      trigger: "template",
    });
    expect(getOrgEnrichmentState("org-1")).toMatchObject({
      status: "pending",
      workflowRunId: run.id,
    });

    updateWorkflowRun(run.id, {
      status: "completed",
      result: JSON.stringify({
        fieldsUpdated: ["description"],
        unresolvedFields: ["website"],
      }),
    });
    expect(getOrgEnrichmentState("org-1")).toMatchObject({
      status: "partial",
      fieldsUpdated: ["description"],
      unresolvedFields: ["website"],
    });
  });
});
