import { listContentItems } from "@/lib/db/queries/content";
import { parsePaginationParams } from "@/lib/pagination";
import { ContentListClient } from "./content-list-client";

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; origin?: string; status?: string; platform?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const { data, total } = listContentItems({
    contentType: params.type,
    origin: params.origin,
    status: params.status,
    platform: params.platform,
    excludeStatus: params.origin && !params.status ? "draft" : undefined,
    page,
    pageSize,
  });

  return (
    <ContentListClient
      content={data}
      total={total}
      page={page}
      pageSize={pageSize}
      currentType={params.type}
      currentOrigin={params.origin}
      currentStatus={params.status}
      currentPlatform={params.platform}
    />
  );
}
