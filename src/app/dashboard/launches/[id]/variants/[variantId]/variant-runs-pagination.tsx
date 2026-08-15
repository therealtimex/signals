"use client";

import { useCallback } from "react";
import { PaginationControls } from "@/components/pagination-controls";
import { createVariantRunsPageUrl } from "./variant-run-timeline-utils";

interface VariantRunsPaginationProps {
  launchId: string;
  variantId: string;
  page: number;
  pageSize: number;
  total: number;
}

export function VariantRunsPagination({
  launchId,
  variantId,
  page,
  pageSize,
  total,
}: VariantRunsPaginationProps) {
  const createPageUrl = useCallback(
    (targetPage: number) => createVariantRunsPageUrl(launchId, variantId, targetPage),
    [launchId, variantId],
  );

  return (
    <PaginationControls
      page={page}
      pageSize={pageSize}
      total={total}
      createPageUrl={createPageUrl}
    />
  );
}
