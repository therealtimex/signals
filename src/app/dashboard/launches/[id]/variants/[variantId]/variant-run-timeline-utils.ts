export function getSimulationDetailHref(runId: string): string {
  return `/dashboard/simulations/${runId}`;
}

export function isSimulationRowActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function getVariantDetailHref(launchId: string, variantId: string): string {
  return `/dashboard/launches/${launchId}/variants/${variantId}`;
}

export function createVariantRunsPageUrl(
  launchId: string,
  variantId: string,
  page: number,
): string {
  const base = getVariantDetailHref(launchId, variantId);
  return page <= 1 ? base : `${base}?page=${page}`;
}
