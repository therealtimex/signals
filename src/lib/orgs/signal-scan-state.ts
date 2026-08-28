import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import { COMPANY_SIGNAL_SCAN_TEMPLATE_NAME } from "@/lib/db/seed-templates";

export type OrgSignalScanState = {
  status: "idle" | "pending" | "succeeded" | "partial" | "failed";
  stale: boolean;
  permissionDenied: boolean;
  lastRunAt: number | null;
  message: string | null;
};

const STALE_AFTER_SECONDS = 7 * 86_400;

export function isOrgSignalScanStale(
  followedAt: number | null,
  lastCompletedAt: number | null,
  now: number,
): boolean {
  if (!followedAt) return false;
  if (!lastCompletedAt) return true;
  return now - lastCompletedAt > STALE_AFTER_SECONDS;
}

function parseJson(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getOrgSignalScanState(
  orgId: string,
  followedAt: number | null,
  now = Math.floor(Date.now() / 1000),
): OrgSignalScanState {
  const template = getSystemTemplateByName(COMPANY_SIGNAL_SCAN_TEMPLATE_NAME);
  const runs = template
    ? listWorkflowRuns({ templateId: template.id, pageSize: 100 }).data.filter((candidate) => parseJson(candidate.config).orgId === orgId)
    : [];
  const run = runs[0];
  const completed = runs.find((candidate) => candidate.status === "completed");
  const lastCompletedAt = completed?.completedAt ?? null;
  const stale = isOrgSignalScanStale(followedAt, lastCompletedAt, now);
  if (!run) return { status: "idle", stale, permissionDenied: false, lastRunAt: null, message: null };
  const result = parseJson(run.result);
  let errors: unknown[] = [];
  try {
    const parsed = JSON.parse(run.errors ?? "[]");
    errors = Array.isArray(parsed) ? parsed : [];
  } catch {
    errors = [];
  }
  const message = errors.length ? errors.map(String).join("; ") : typeof result.error === "string" ? result.error : null;
  const permissionDenied = /permission|forbidden|access denied/i.test(message ?? "");
  const lastRunAt = lastCompletedAt;
  const status = ["pending", "running", "paused"].includes(run.status) ? "pending"
    : run.status === "failed" || run.status === "cancelled" ? "failed"
      : result.partial === true || errors.length > 0 ? "partial" : "succeeded";
  return { status, stale, permissionDenied, lastRunAt, message };
}
