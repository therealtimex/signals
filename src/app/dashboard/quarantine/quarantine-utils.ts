import type { QuarantineStatusFilter } from "./types";

type QuarantineFilterState = {
  status: QuarantineStatusFilter;
  search?: string;
  failureReason?: string;
  workflowRunId?: string;
};

function toQuarantineUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/dashboard/quarantine?${query}` : "/dashboard/quarantine";
}

export function statusFilterParam(status: QuarantineStatusFilter): string | undefined {
  return status === "identity_unverified" ? undefined : status;
}

export function failureReasonFilterParam(reason: string): string | undefined {
  return reason === "all" ? undefined : reason;
}

export function formatCandidateTimestamp(unix: number): string {
  const date = new Date(unix * 1_000);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function buildQuarantineFilterParams(state: QuarantineFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.status !== "identity_unverified") params.set("status", state.status);
  if (state.search) params.set("search", state.search);
  if (state.failureReason) params.set("reason", state.failureReason);
  if (state.workflowRunId) params.set("workflowRunId", state.workflowRunId);
  return params;
}

export function updateQuarantineFilterUrl(
  current: URLSearchParams,
  key: string,
  value?: string,
): string {
  const params = new URLSearchParams(current);
  if (value) params.set(key, value);
  else params.delete(key);
  return toQuarantineUrl(params);
}

export function quarantinePageUrl(current: URLSearchParams, page: number): string {
  const params = new URLSearchParams(current);
  if (page > 1) params.set("page", String(page));
  else params.delete("page");
  return toQuarantineUrl(params);
}

export function quarantineFiltersActive(state: QuarantineFilterState): boolean {
  return Boolean(
    state.search ||
    state.failureReason ||
    state.workflowRunId ||
    state.status !== "identity_unverified"
  );
}
