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

function parseJson(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getOrgSignalScanState(orgId: string, now = Math.floor(Date.now() / 1000)): OrgSignalScanState {
  const template = getSystemTemplateByName(COMPANY_SIGNAL_SCAN_TEMPLATE_NAME);
  const run = template
    ? listWorkflowRuns({ templateId: template.id, pageSize: 100 }).data.find((candidate) => parseJson(candidate.config).orgId === orgId)
    : undefined;
  if (!run) return { status: "idle", stale: true, permissionDenied: false, lastRunAt: null, message: null };
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
  const lastRunAt = run.completedAt ?? run.startedAt ?? run.createdAt;
  const stale = now - lastRunAt > 90 * 86_400;
  const status = ["pending", "running", "paused"].includes(run.status) ? "pending"
    : run.status === "failed" || run.status === "cancelled" ? "failed"
      : result.partial === true || errors.length > 0 ? "partial" : "succeeded";
  return { status, stale, permissionDenied, lastRunAt, message };
}
