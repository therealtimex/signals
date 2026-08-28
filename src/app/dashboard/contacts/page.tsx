import { Suspense } from "react";
import { listContacts } from "@/lib/db/queries/contacts";
import {
  listContactProvenanceTemplates,
  listContactProvenanceWorkflowRuns,
} from "@/lib/db/queries/contact-list-provenance";
import { parsePaginationParams } from "@/lib/pagination";
import {
  enrichmentTierToScoreRange,
  parseContactListSort,
} from "@/lib/contacts/list-filters";
import {
  contactListHasUserFilters,
  formatContactListCountLabel,
  parseContactListFilterState,
} from "@/lib/contacts/list-filter-state";
import { ContactListClient } from "./contact-list-client";
import type { CreatedSource } from "@/lib/db/creation-sources";
import { CreatedSourceDetailFilterError } from "@/lib/db/creation-sources";
import { notFound } from "next/navigation";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseContactListFilterState(params);
  const { page, pageSize } = parsePaginationParams(params);
  const includeArchived = filters.archived === true;
  const { sort, order } = parseContactListSort(filters.sort, filters.order);
  const tierRange = filters.enrichmentTier
    ? enrichmentTierToScoreRange(filters.enrichmentTier)
    : null;

  let data;
  let total;
  try {
    const result = listContacts({
      search: filters.search,
      funnelStage: filters.funnelStage,
      platform: filters.platform,
      relationshipGoal: filters.relationshipGoal,
      relationshipGoalStatus: filters.relationshipGoalStatus,
      page,
      pageSize,
      includeArchived,
      sort,
      order,
      createdWorkflowRunId: filters.createdWorkflowRunId,
      createdSourceDetail: filters.createdSourceDetail,
      createdTemplateId: filters.createdTemplateId,
      hasRelationshipGoal: filters.hasRelationshipGoal,
      ...(filters.createdSource ? { createdSource: filters.createdSource as CreatedSource } : {}),
      ...(filters.minEnrichmentScore && !tierRange
        ? { minEnrichmentScore: parseInt(filters.minEnrichmentScore, 10) }
        : {}),
      ...(filters.maxEnrichmentScore && !tierRange
        ? { maxEnrichmentScore: parseInt(filters.maxEnrichmentScore, 10) }
        : {}),
      ...(tierRange?.minEnrichmentScore !== undefined
        ? { minEnrichmentScore: tierRange.minEnrichmentScore }
        : {}),
      ...(tierRange?.maxEnrichmentScore !== undefined
        ? { maxEnrichmentScore: tierRange.maxEnrichmentScore }
        : {}),
    });
    data = result.data;
    total = result.total;
  } catch (error) {
    if (error instanceof CreatedSourceDetailFilterError) {
      notFound();
    }
    throw error;
  }

  const provenanceTemplates = listContactProvenanceTemplates();
  const provenanceWorkflowRuns = listContactProvenanceWorkflowRuns();
  const unfilteredTotal = listContacts({ includeArchived, pageSize: 1 }).total;
  const hasUserFilters = contactListHasUserFilters(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Contacts</h1>
        <p className="text-muted-foreground mt-1">
          {formatContactListCountLabel(total, unfilteredTotal, hasUserFilters)}
        </p>
      </div>
      <Suspense>
        <ContactListClient
          contacts={data}
          total={total}
          page={page}
          pageSize={pageSize}
          filters={filters}
          provenanceTemplates={provenanceTemplates}
          provenanceWorkflowRuns={provenanceWorkflowRuns}
        />
      </Suspense>
    </div>
  );
}
