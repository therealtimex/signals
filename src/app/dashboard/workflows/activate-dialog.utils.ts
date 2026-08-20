import {
  PROFILE_PIPELINE_DEFAULT_BATCH,
  PROFILE_PIPELINE_MAX_BATCH,
} from "@/lib/workflows/pipeline/types";

export function clampPipelineBatchSize(batchSize: number, backlogTotal: number): number {
  const maxBatch = Math.min(
    PROFILE_PIPELINE_MAX_BATCH,
    Math.max(1, backlogTotal),
  );
  return Math.min(Math.max(1, Math.floor(batchSize)), maxBatch);
}

export function readRunLimitFromTemplateConfig(
  templateConfig: Record<string, unknown>,
): {
  maxResults: string;
  maxContacts: string;
  maxEnrichmentScore: string;
  companyName: string;
  inactivityDays: string;
  topics: string;
  tone: string;
  maxEngagements: string;
} {
  return {
    maxResults: String(templateConfig.maxResults ?? 20),
    maxContacts: String(templateConfig.maxContacts ?? 10),
    maxEnrichmentScore: String(templateConfig.maxEnrichmentScore ?? 50),
    companyName: String(templateConfig.companyName ?? ""),
    inactivityDays: String(templateConfig.inactivityDays ?? 365),
    topics: ((templateConfig.topics as string[] | undefined) ?? []).join(", "),
    tone: String(templateConfig.tone ?? "professional"),
    maxEngagements: String(
      templateConfig.maxEngagements ?? templateConfig.maxReplies ?? 10,
    ),
  };
}

export { PROFILE_PIPELINE_DEFAULT_BATCH, PROFILE_PIPELINE_MAX_BATCH };
