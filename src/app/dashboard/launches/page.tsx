import { listLaunches } from "@/lib/db/queries/launches";
import { LAUNCH_STATUSES } from "@/lib/db/gtm-status";
import { LaunchesListClient } from "./launches-list-client";

export default async function LaunchesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    search?: string;
    page?: string;
    includeLocalOnly?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 20;
  const includeLocalOnly = params.includeLocalOnly === "true";
  const status = LAUNCH_STATUSES.includes(
    (params.status ?? "") as (typeof LAUNCH_STATUSES)[number],
  )
    ? (params.status as (typeof LAUNCH_STATUSES)[number])
    : undefined;

  const unfiltered = listLaunches({ page: 1, pageSize: 1, includeLocalOnly: true });
  const { data, total } = listLaunches({
    search: params.search,
    status,
    page,
    pageSize,
    includeLocalOnly,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Launches</h1>
        <p className="text-muted-foreground mt-1">
          Plan GTM launches and compare variants in the Wind Tunnel.
        </p>
      </div>
      <LaunchesListClient
        launches={data}
        total={total}
        page={page}
        pageSize={pageSize}
        currentStatus={params.status}
        currentSearch={params.search}
        includeLocalOnly={includeLocalOnly}
        hasAnyLaunches={unfiltered.total > 0}
      />
    </div>
  );
}
