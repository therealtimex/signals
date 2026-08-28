import {
  CREATION_TAG_LABELS,
  isCreationTag,
  type CreatedSource,
} from "@/lib/db/creation-sources";

export type ProvenanceSummary = {
  label: string;
  dateLabel: string;
  sourceDetail: string | null;
  runId: string | null;
  templateId: string | null;
};

export function formatProvenanceLine(input: {
  createdSource: CreatedSource | null;
  createdSourceDetail: string | null;
  legacySource?: string | null;
  createdWorkflowRunId: string | null;
  createdTemplateId: string | null;
  createdTemplateName?: string | null;
  createdAt: number;
}): ProvenanceSummary {
  const source = input.createdSource;
  const detail = input.createdSourceDetail ?? input.legacySource ?? null;
  let label = "Source unknown";

  if (source === "manual" || detail === "ui") {
    label = "Manually added";
  } else if (source === "import") {
    label = detail && isCreationTag(detail) ? CREATION_TAG_LABELS[detail] : "Imported";
  } else if (source === "sync") {
    label = detail && isCreationTag(detail) ? CREATION_TAG_LABELS[detail] : "Synced";
  } else if (source === "agent" || detail === "agent" || detail?.startsWith("agent:")) {
    label = input.createdTemplateName ? `${input.createdTemplateName} agent` : "Agent added";
  } else if (source === "api") {
    label = "Added via API";
  } else if (detail === "email_domain") {
    label = "Derived from an email domain";
  } else if (detail?.startsWith("backfill:")) {
    label = "Derived from contact records";
  }

  return {
    label,
    dateLabel: new Date(input.createdAt * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    sourceDetail: detail,
    runId: input.createdWorkflowRunId,
    templateId: input.createdTemplateId,
  };
}

export function fieldProvenanceLabel(source: string): string {
  if (source === "manual") return "Manually edited";
  if (source === "agent") return "Agent enriched";
  if (source === "import") return "Imported";
  if (source === "api") return "Updated via API";
  if (source === "derived") return "Derived";
  return "Updated";
}
