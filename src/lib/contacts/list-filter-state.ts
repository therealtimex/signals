import {
  CREATION_TAG_LABELS,
  type CreatedSource,
  type CreationTag,
} from "@/lib/db/creation-sources";
import {
  CONTACT_LIST_SORT_OPTIONS,
  ENRICHMENT_TIER_LABELS,
  RELATIONSHIP_GOAL_FILTER_OPTIONS,
  RELATIONSHIP_GOAL_STATUS_FILTER_OPTIONS,
  contactListSortValue,
  type EnrichmentTier,
} from "@/lib/contacts/list-filters";
import { PLATFORM_DISPLAY_NAMES } from "@/lib/platforms/capabilities";
import type { Platform } from "@/lib/db/platforms";

export const CONTACT_LIST_QUERY_KEYS = [
  "search",
  "funnelStage",
  "platform",
  "relationshipGoal",
  "relationshipGoalStatus",
  "enrichmentTier",
  "sort",
  "order",
  "createdSource",
  "createdSourceDetail",
  "createdTemplateId",
  "createdWorkflowRunId",
  "hasRelationshipGoal",
  "minEnrichmentScore",
  "maxEnrichmentScore",
  "archived",
  "page",
] as const;

export type ContactListQueryKey = (typeof CONTACT_LIST_QUERY_KEYS)[number];

export type ContactListFilterState = {
  search?: string;
  funnelStage?: string;
  platform?: string;
  relationshipGoal?: string;
  relationshipGoalStatus?: string;
  enrichmentTier?: string;
  sort?: string;
  order?: string;
  createdSource?: string;
  createdSourceDetail?: string;
  createdTemplateId?: string;
  createdWorkflowRunId?: string;
  hasRelationshipGoal?: boolean;
  minEnrichmentScore?: string;
  maxEnrichmentScore?: string;
  archived?: boolean;
};

/** Contact-relevant creation tags for provenance filtering (subset of CREATION_TAGS). */
export const CONTACT_CREATION_DETAIL_TAGS: CreationTag[] = [
  "manual:create_contact",
  "api:create_contact",
  "agent:create_contact",
  "import:x_archive",
  "import:linkedin_csv",
  "import:gmail_takeout",
  "sync:x_contacts",
  "sync:linkedin_contacts",
  "sync:gmail_contacts",
  "sync:himalaya_correspondents",
];

export const CREATED_SOURCE_FILTER_OPTIONS: { value: CreatedSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent / workflow" },
  { value: "import", label: "Import" },
  { value: "sync", label: "Sync" },
  { value: "api", label: "API" },
];

export function parseContactListFilterState(
  params: Record<string, string | undefined>,
): ContactListFilterState {
  return {
    search: params.search?.trim() || undefined,
    funnelStage: params.funnelStage || undefined,
    platform: params.platform || undefined,
    relationshipGoal: params.relationshipGoal || undefined,
    relationshipGoalStatus: params.relationshipGoalStatus || undefined,
    enrichmentTier:
      params.enrichmentTier && params.enrichmentTier !== "all"
        ? params.enrichmentTier
        : undefined,
    sort: params.sort || undefined,
    order: params.order || undefined,
    createdSource: params.createdSource || undefined,
    createdSourceDetail: params.createdSourceDetail || undefined,
    createdTemplateId: params.createdTemplateId || undefined,
    createdWorkflowRunId: params.createdWorkflowRunId || undefined,
    hasRelationshipGoal: params.hasRelationshipGoal === "true",
    minEnrichmentScore: params.minEnrichmentScore || undefined,
    maxEnrichmentScore: params.maxEnrichmentScore || undefined,
    archived: params.archived === "true",
  };
}

export function contactListFiltersToSearchParams(
  filters: ContactListFilterState,
  base?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "");

  for (const key of CONTACT_LIST_QUERY_KEYS) {
    if (key === "page") continue;
    params.delete(key);
  }

  if (filters.search) params.set("search", filters.search);
  if (filters.funnelStage && filters.funnelStage !== "all") {
    params.set("funnelStage", filters.funnelStage);
  }
  if (filters.platform && filters.platform !== "all") {
    params.set("platform", filters.platform);
  }
  if (filters.relationshipGoal && filters.relationshipGoal !== "all") {
    params.set("relationshipGoal", filters.relationshipGoal);
  }
  if (filters.relationshipGoalStatus && filters.relationshipGoalStatus !== "all") {
    params.set("relationshipGoalStatus", filters.relationshipGoalStatus);
  }
  if (filters.enrichmentTier && filters.enrichmentTier !== "all") {
    params.set("enrichmentTier", filters.enrichmentTier);
  }
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.createdSource && filters.createdSource !== "all") {
    params.set("createdSource", filters.createdSource);
  }
  if (filters.createdSourceDetail && filters.createdSourceDetail !== "all") {
    params.set("createdSourceDetail", filters.createdSourceDetail);
  }
  if (filters.createdTemplateId && filters.createdTemplateId !== "all") {
    params.set("createdTemplateId", filters.createdTemplateId);
  }
  if (filters.createdWorkflowRunId && filters.createdWorkflowRunId !== "all") {
    params.set("createdWorkflowRunId", filters.createdWorkflowRunId);
  }
  if (filters.hasRelationshipGoal) params.set("hasRelationshipGoal", "true");
  if (filters.minEnrichmentScore) params.set("minEnrichmentScore", filters.minEnrichmentScore);
  if (filters.maxEnrichmentScore) params.set("maxEnrichmentScore", filters.maxEnrichmentScore);
  if (filters.archived) params.set("archived", "true");

  return params;
}

export type ContactListFilterChip = {
  id: string;
  label: string;
  removeKeys: ContactListQueryKey[];
};

function funnelStageLabel(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function describeContactListFilterChips(
  filters: ContactListFilterState,
  options?: {
    templateNames?: Record<string, string>;
    workflowRunLabels?: Record<string, string>;
  },
): ContactListFilterChip[] {
  const chips: ContactListFilterChip[] = [];
  const templateNames = options?.templateNames ?? {};
  const workflowRunLabels = options?.workflowRunLabels ?? {};

  if (filters.search) {
    chips.push({
      id: "search",
      label: `Search: ${filters.search}`,
      removeKeys: ["search"],
    });
  }
  if (filters.funnelStage) {
    chips.push({
      id: "funnelStage",
      label: `Stage: ${funnelStageLabel(filters.funnelStage)}`,
      removeKeys: ["funnelStage"],
    });
  }
  if (filters.platform) {
    const platformLabel =
      PLATFORM_DISPLAY_NAMES[filters.platform as Platform] ?? filters.platform;
    chips.push({
      id: "platform",
      label: `Platform: ${platformLabel}`,
      removeKeys: ["platform"],
    });
  }
  if (filters.relationshipGoal) {
    const goalLabel =
      RELATIONSHIP_GOAL_FILTER_OPTIONS.find((g) => g.value === filters.relationshipGoal)?.label ??
      filters.relationshipGoal;
    chips.push({
      id: "relationshipGoal",
      label: `Goal: ${goalLabel}`,
      removeKeys: ["relationshipGoal"],
    });
  }
  if (filters.relationshipGoalStatus) {
    const statusLabel =
      RELATIONSHIP_GOAL_STATUS_FILTER_OPTIONS.find(
        (s) => s.value === filters.relationshipGoalStatus,
      )?.label ?? filters.relationshipGoalStatus;
    chips.push({
      id: "relationshipGoalStatus",
      label: `Goal status: ${statusLabel}`,
      removeKeys: ["relationshipGoalStatus"],
    });
  }
  if (filters.hasRelationshipGoal) {
    chips.push({
      id: "hasRelationshipGoal",
      label: "Has relationship goal",
      removeKeys: ["hasRelationshipGoal"],
    });
  }
  if (filters.enrichmentTier) {
    const tier = filters.enrichmentTier as EnrichmentTier;
    chips.push({
      id: "enrichmentTier",
      label: `Enrichment: ${ENRICHMENT_TIER_LABELS[tier] ?? filters.enrichmentTier}`,
      removeKeys: ["enrichmentTier", "minEnrichmentScore", "maxEnrichmentScore"],
    });
  }
  if (filters.minEnrichmentScore && !filters.enrichmentTier) {
    chips.push({
      id: "minEnrichmentScore",
      label: `Min enrichment: ${filters.minEnrichmentScore}`,
      removeKeys: ["minEnrichmentScore"],
    });
  }
  if (filters.maxEnrichmentScore && !filters.enrichmentTier) {
    chips.push({
      id: "maxEnrichmentScore",
      label: `Max enrichment: ${filters.maxEnrichmentScore}`,
      removeKeys: ["maxEnrichmentScore"],
    });
  }
  if (contactListSortValue(filters.sort, filters.order) !== "createdAt-desc") {
    const sortLabel =
      CONTACT_LIST_SORT_OPTIONS.find(
        (entry) => entry.value === contactListSortValue(filters.sort, filters.order),
      )?.label ?? "Custom sort";
    chips.push({
      id: "sort",
      label: `Sort: ${sortLabel}`,
      removeKeys: ["sort", "order"],
    });
  }
  if (filters.createdSource) {
    const sourceLabel =
      CREATED_SOURCE_FILTER_OPTIONS.find((s) => s.value === filters.createdSource)?.label ??
      filters.createdSource;
    chips.push({
      id: "createdSource",
      label: `Source: ${sourceLabel}`,
      removeKeys: ["createdSource"],
    });
  }
  if (filters.createdSourceDetail) {
    const detailLabel =
      CREATION_TAG_LABELS[filters.createdSourceDetail as CreationTag] ??
      filters.createdSourceDetail;
    chips.push({
      id: "createdSourceDetail",
      label: `Provenance: ${detailLabel}`,
      removeKeys: ["createdSourceDetail"],
    });
  }
  if (filters.createdTemplateId) {
    chips.push({
      id: "createdTemplateId",
      label: `Template: ${templateNames[filters.createdTemplateId] ?? filters.createdTemplateId.slice(0, 8)}`,
      removeKeys: ["createdTemplateId"],
    });
  }
  if (filters.createdWorkflowRunId) {
    chips.push({
      id: "createdWorkflowRunId",
      label:
        workflowRunLabels[filters.createdWorkflowRunId] ??
        `Run: ${filters.createdWorkflowRunId.slice(0, 8)}`,
      removeKeys: ["createdWorkflowRunId"],
    });
  }

  return chips;
}

export function contactListHasUserFilters(filters: ContactListFilterState): boolean {
  return describeContactListFilterChips(filters).length > 0;
}

export function contactListHasProvenanceFilters(filters: ContactListFilterState): boolean {
  return Boolean(
    filters.createdSource ||
      filters.createdSourceDetail ||
      filters.createdTemplateId ||
      filters.createdWorkflowRunId,
  );
}

export function formatContactListCountLabel(
  filteredTotal: number,
  unfilteredTotal: number,
  hasUserFilters: boolean,
): string {
  if (hasUserFilters && filteredTotal !== unfilteredTotal) {
    return `${filteredTotal.toLocaleString()} of ${unfilteredTotal.toLocaleString()} contacts`;
  }
  if (filteredTotal === 1) return "1 contact";
  return `${filteredTotal.toLocaleString()} contacts`;
}

export function removeContactListFilterKeys(
  filters: ContactListFilterState,
  keys: ContactListQueryKey[],
): ContactListFilterState {
  const next = { ...filters };
  for (const key of keys) {
    switch (key) {
      case "search":
        delete next.search;
        break;
      case "funnelStage":
        delete next.funnelStage;
        break;
      case "platform":
        delete next.platform;
        break;
      case "relationshipGoal":
        delete next.relationshipGoal;
        break;
      case "relationshipGoalStatus":
        delete next.relationshipGoalStatus;
        break;
      case "enrichmentTier":
        delete next.enrichmentTier;
        delete next.minEnrichmentScore;
        delete next.maxEnrichmentScore;
        break;
      case "sort":
        delete next.sort;
        delete next.order;
        break;
      case "order":
        delete next.sort;
        delete next.order;
        break;
      case "createdSource":
        delete next.createdSource;
        break;
      case "createdSourceDetail":
        delete next.createdSourceDetail;
        break;
      case "createdTemplateId":
        delete next.createdTemplateId;
        break;
      case "createdWorkflowRunId":
        delete next.createdWorkflowRunId;
        break;
      case "hasRelationshipGoal":
        delete next.hasRelationshipGoal;
        break;
      case "minEnrichmentScore":
        delete next.minEnrichmentScore;
        break;
      case "maxEnrichmentScore":
        delete next.maxEnrichmentScore;
        break;
      case "archived":
        delete next.archived;
        break;
      case "page":
        break;
      default:
        break;
    }
  }
  return next;
}

export function normalizeContactListFiltersForCompare(
  filters: ContactListFilterState,
): Record<string, string> {
  const params = contactListFiltersToSearchParams(filters);
  const normalized: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key === "page" || key === "archived") continue;
    normalized[key] = value;
  }
  return normalized;
}

export function contactListFiltersEqual(
  a: ContactListFilterState,
  b: ContactListFilterState,
): boolean {
  const left = normalizeContactListFiltersForCompare(a);
  const right = normalizeContactListFiltersForCompare(b);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
