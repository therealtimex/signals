import { getOwnerContactId, listContacts, getContactById } from "@/lib/db/queries/contacts";
import { parsePaginationParams } from "@/lib/pagination";
import { ContactListClient } from "./contact-list-client";
import type { CreatedSource } from "@/lib/db/creation-sources";
import { CreatedSourceDetailFilterError } from "@/lib/db/creation-sources";
import { notFound } from "next/navigation";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    funnelStage?: string;
    platform?: string;
    page?: string;
    archived?: string;
    createdWorkflowRunId?: string;
    createdSource?: string;
    createdSourceDetail?: string;
    createdTemplateId?: string;
    minEnrichmentScore?: string;
    maxEnrichmentScore?: string;
  }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const includeArchived = params.archived === "true";
  const ownerId = getOwnerContactId();
  const selfContact = ownerId ? getContactById(ownerId) : undefined;

  let data;
  let total;
  try {
    const result = listContacts({
      search: params.search,
      funnelStage: params.funnelStage,
      platform: params.platform,
      page,
      pageSize,
      includeArchived,
      createdWorkflowRunId: params.createdWorkflowRunId,
      createdSourceDetail: params.createdSourceDetail,
      createdTemplateId: params.createdTemplateId,
      ...(params.createdSource ? { createdSource: params.createdSource as CreatedSource } : {}),
      ...(params.minEnrichmentScore
        ? { minEnrichmentScore: parseInt(params.minEnrichmentScore, 10) }
        : {}),
      ...(params.maxEnrichmentScore
        ? { maxEnrichmentScore: parseInt(params.maxEnrichmentScore, 10) }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Contacts</h1>
        <p className="text-muted-foreground mt-1">
          Manage your CRM contacts across platforms.
        </p>
      </div>
      <ContactListClient
        contacts={data}
        selfContact={selfContact}
        total={total}
        page={page}
        pageSize={pageSize}
        currentSearch={params.search}
        currentFunnelStage={params.funnelStage}
        includeArchived={includeArchived}
        currentWorkflowRunId={params.createdWorkflowRunId}
      />
    </div>
  );
}
