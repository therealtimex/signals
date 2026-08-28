import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME } from "@/lib/db/seed-templates";

export type OrgEnrichmentState = {
  status: "idle" | "pending" | "succeeded" | "partial" | "failed";
  workflowRunId: string | null;
  lastRunAt: number | null;
  fieldsUpdated: string[];
  unresolvedFields: string[];
  message: string | null;
};

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function getOrgEnrichmentState(orgId: string): OrgEnrichmentState {
  const template = getSystemTemplateByName(COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME);
  if (!template) {
    return { status: "idle", workflowRunId: null, lastRunAt: null, fieldsUpdated: [], unresolvedFields: [], message: null };
  }

  const run = listWorkflowRuns({ templateId: template.id, pageSize: 100 }).data.find((candidate) => {
    const config = parseObject(candidate.config);
    return config.orgId === orgId;
  });
  if (!run) {
    return { status: "idle", workflowRunId: null, lastRunAt: null, fieldsUpdated: [], unresolvedFields: [], message: null };
  }

  const result = parseObject(run.result);
  const fieldsUpdated = stringArray(result.fieldsUpdated);
  const unresolvedFields = stringArray(result.unresolvedFields);
  const errors = stringArray(result.errors).length > 0 || Boolean(run.errors);
  let status: OrgEnrichmentState["status"];
  if (run.status === "pending" || run.status === "running" || run.status === "paused") {
    status = "pending";
  } else if (run.status === "failed" || run.status === "cancelled") {
    status = "failed";
  } else if (result.partial === true || errors || unresolvedFields.length > 0) {
    status = "partial";
  } else {
    status = "succeeded";
  }

  return {
    status,
    workflowRunId: run.id,
    lastRunAt: run.completedAt ?? run.startedAt ?? run.createdAt,
    fieldsUpdated,
    unresolvedFields,
    message: typeof result.message === "string" ? result.message : null,
  };
}
