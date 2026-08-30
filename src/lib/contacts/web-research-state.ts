import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME } from "@/lib/db/seed-templates";

export type ContactWebResearchState = {
  status: "idle" | "pending" | "succeeded" | "partial" | "failed";
  workflowRunId: string | null;
  lastRunAt: number | null;
  fieldsUpdated: string[];
  unresolvedFields: string[];
  identityLinked: boolean;
  visitedUrls: string[];
  ambiguous: boolean;
  serpCandidates: Array<{ url: string; totalScore: number; reason: string }>;
  message: string | null;
};

const IDLE_STATE: ContactWebResearchState = {
  status: "idle",
  workflowRunId: null,
  lastRunAt: null,
  fieldsUpdated: [],
  unresolvedFields: [],
  identityLinked: false,
  visitedUrls: [],
  ambiguous: false,
  serpCandidates: [],
  message: null,
};

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseSerpCandidates(
  value: unknown,
): ContactWebResearchState["serpCandidates"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.url !== "string" || typeof row.totalScore !== "number") return [];
    return [{
      url: row.url,
      totalScore: row.totalScore,
      reason: typeof row.reason === "string" ? row.reason : "",
    }];
  });
}

export function getContactWebResearchState(contactId: string): ContactWebResearchState {
  const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME);
  if (!template) return { ...IDLE_STATE };

  const run = listWorkflowRuns({ templateId: template.id, pageSize: 100 }).data.find(
    (candidate) => parseObject(candidate.config).contactId === contactId,
  );
  if (!run) return { ...IDLE_STATE };

  const result = parseObject(run.result);
  const unresolvedFields = stringArray(result.unresolvedFields);
  const errors = stringArray(result.errors).length > 0 || Boolean(run.errors);
  let status: ContactWebResearchState["status"];
  if (run.status === "pending" || run.status === "running" || run.status === "paused") {
    status = "pending";
  } else if (run.status === "failed" || run.status === "cancelled") {
    status = "failed";
  } else if (
    result.partial === true ||
    result.ambiguous === true ||
    errors ||
    unresolvedFields.length > 0
  ) {
    status = "partial";
  } else {
    status = "succeeded";
  }

  return {
    status,
    workflowRunId: run.id,
    lastRunAt: run.completedAt ?? run.startedAt ?? run.createdAt,
    fieldsUpdated: stringArray(result.fieldsUpdated),
    unresolvedFields,
    identityLinked: result.identityLinked === true,
    visitedUrls: stringArray(result.visitedUrls),
    ambiguous: result.ambiguous === true,
    serpCandidates: parseSerpCandidates(result.serpCandidates),
    message: typeof result.message === "string" ? result.message : null,
  };
}

export { shouldRunWebResearch } from "@/lib/contacts/web-research-router";
