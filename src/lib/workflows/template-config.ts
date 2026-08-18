export type TemplateLimits = {
  maxResults?: number;
  maxContacts?: number;
  maxEnrichmentScore?: number;
  companyName?: string;
  inactivityDays?: number;
  topics?: string[];
  tone?: string;
  maxEngagements?: number;
};

export function parseTemplateConfig(config: string | null | undefined): Record<string, unknown> {
  if (!config?.trim()) return {};
  try {
    const parsed = JSON.parse(config);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildTemplateConfig(
  templateType: string,
  limits: TemplateLimits = {},
  existingConfig?: string | null
): string {
  const base = parseTemplateConfig(existingConfig);
  const config: Record<string, unknown> = { ...base };

  switch (templateType) {
    case "prospecting":
      if (limits.maxResults !== undefined) config.maxResults = limits.maxResults;
      break;
    case "enrichment":
      if (limits.maxContacts !== undefined) config.maxContacts = limits.maxContacts;
      if (limits.maxEnrichmentScore !== undefined) {
        config.maxEnrichmentScore = limits.maxEnrichmentScore;
      }
      break;
    case "pruning":
      if (limits.maxContacts !== undefined) config.maxContacts = limits.maxContacts;
      if (limits.companyName !== undefined) config.companyName = limits.companyName;
      if (limits.inactivityDays !== undefined) config.inactivityDays = limits.inactivityDays;
      break;
    case "content":
      if (limits.topics !== undefined) config.topics = limits.topics;
      if (limits.tone !== undefined) config.tone = limits.tone;
      break;
    case "engagement":
    case "outreach":
      if (limits.maxEngagements !== undefined) {
        config.maxEngagements = limits.maxEngagements;
        config.maxReplies = limits.maxEngagements;
      }
      break;
    default:
      break;
  }

  return JSON.stringify(config);
}

export function extractLimitsFromConfig(
  templateType: string,
  config: string | null | undefined
): TemplateLimits {
  const parsed = parseTemplateConfig(config);
  switch (templateType) {
    case "prospecting":
      return { maxResults: numberOrUndefined(parsed.maxResults) };
    case "enrichment":
      return {
        maxContacts: numberOrUndefined(parsed.maxContacts),
        maxEnrichmentScore: numberOrUndefined(parsed.maxEnrichmentScore),
      };
    case "pruning":
      return {
        maxContacts: numberOrUndefined(parsed.maxContacts),
        companyName: stringOrUndefined(parsed.companyName),
        inactivityDays: numberOrUndefined(parsed.inactivityDays),
      };
    case "content":
      return {
        topics: Array.isArray(parsed.topics)
          ? parsed.topics.filter((t): t is string => typeof t === "string")
          : undefined,
        tone: stringOrUndefined(parsed.tone),
      };
    case "engagement":
    case "outreach":
      return {
        maxEngagements: numberOrUndefined(parsed.maxEngagements ?? parsed.maxReplies),
      };
    default:
      return {};
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
