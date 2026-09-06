import { readOrgDedupeControls, tierPresetFor } from "@/lib/orgs/dedupe/template";
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
  orgDedupeTiers: string;
  orgDedupeLimit: string;
} {
  const orgDedupe = readOrgDedupeControls(templateConfig);
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
    orgDedupeTiers: tierPresetFor(orgDedupe.tiers),
    orgDedupeLimit: String(orgDedupe.limit),
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

/** Render a platform target as `Facebook: Le Dang Trung (ledangtrung)` for the acting-profile picker. */
export function actingTargetLabel(target: {
  platform: string;
  name: string;
  handle?: string | null;
}): string {
  const platform = PLATFORM_LABELS[target.platform] ?? target.platform;
  const handle = target.handle?.trim();
  return handle ? `${platform}: ${target.name} (${handle})` : `${platform}: ${target.name}`;
}

export { PROFILE_PIPELINE_DEFAULT_BATCH, PROFILE_PIPELINE_MAX_BATCH };
