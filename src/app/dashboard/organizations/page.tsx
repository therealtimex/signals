import {
  listOrgsWithContactCounts,
  type OrgListPeopleFilter,
  type OrgListSort,
  type OrgListSource,
} from "@/lib/db/queries/orgs";
import { parsePaginationParams } from "@/lib/pagination";
import { OrganizationListClient } from "./organization-list-client";

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
    people?: string;
    source?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const people = (["multiple", "unlinked"] as const).find((v) => v === params.people);
  const source = (["import", "agent"] as const).find((v) => v === params.source);
  const sort = (["people", "name"] as const).find((v) => v === params.sort);

  const { data, total } = listOrgsWithContactCounts({
    search: params.search,
    page,
    pageSize,
    people: people as OrgListPeopleFilter | undefined,
    source: source as OrgListSource | undefined,
    sort: sort as OrgListSort | undefined,
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
        currentPeople={people}
        currentSource={source}
        currentSort={sort}
      />
    </div>
  );
}
