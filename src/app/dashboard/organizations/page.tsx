import { listOrgsWithContactCounts } from "@/lib/db/queries/orgs";
import { parsePaginationParams } from "@/lib/pagination";
import { OrganizationListClient } from "./organization-list-client";

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const { data, total } = listOrgsWithContactCounts({
    search: params.search,
    page,
    pageSize,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Companies</h1>
        <p className="text-muted-foreground mt-1">
          Browse companies, funds, and teams linked to your people.
        </p>
      </div>
      <OrganizationListClient
        orgs={data}
        total={total}
        page={page}
        pageSize={pageSize}
        currentSearch={params.search}
      />
    </div>
  );
}
