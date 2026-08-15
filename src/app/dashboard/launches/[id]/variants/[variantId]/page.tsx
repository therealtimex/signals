import { notFound } from "next/navigation";
import { getLaunchById } from "@/lib/db/queries/launches";
import { listSimulationRuns } from "@/lib/db/queries/simulations";
import { getVariantById } from "@/lib/db/queries/variants";
import { findProjectionSourceRunId } from "@/lib/simulation-run-display";
import { VariantDetailView } from "./variant-detail-view";

const RUNS_PAGE_SIZE = 20;

export default async function VariantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; variantId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id, variantId } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  const variant = getVariantById(variantId);
  if (!variant || variant.launchId !== id) {
    notFound();
  }

  const launch = getLaunchById(id);
  if (!launch) {
    notFound();
  }

  const { data: runs, total } = listSimulationRuns({
    variantId: variant.id,
    page,
    pageSize: RUNS_PAGE_SIZE,
  });

  const projectionSourceRunId = findProjectionSourceRunId(runs);

  return (
    <VariantDetailView
      launch={launch}
      variant={variant}
      runs={runs}
      runsTotal={total}
      runsPage={page}
      runsPageSize={RUNS_PAGE_SIZE}
      projectionSourceRunId={projectionSourceRunId}
    />
  );
}
