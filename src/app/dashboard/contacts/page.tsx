import { getOwnerContactId, listContacts, getContactById } from "@/lib/db/queries/contacts";
import { parsePaginationParams } from "@/lib/pagination";
import { ContactListClient } from "./contact-list-client";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; funnelStage?: string; platform?: string; page?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const includeArchived = params.archived === "true";
  const ownerId = getOwnerContactId();
  const selfContact = ownerId ? getContactById(ownerId) : undefined;
  const { data, total } = listContacts({
    search: params.search,
    funnelStage: params.funnelStage,
    platform: params.platform,
    page,
    pageSize,
    includeArchived,
  });

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
      />
    </div>
  );
}
