import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { listWorkflowRuns } from "@/lib/db/queries/workflows";
import {
  COMPANY_SIGNAL_SCAN_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  seedTemplates();
  const template = getSystemTemplateByName(COMPANY_SIGNAL_SCAN_TEMPLATE_NAME)!;
  const pending = listWorkflowRuns({ templateId: template.id, pageSize: 100 }).data.find((run) => {
    if (!["pending", "running", "paused"].includes(run.status)) return false;
    try {
      return (JSON.parse(run.config ?? "{}") as { orgId?: string }).orgId === id;
    } catch {
      return false;
    }
  });
  if (pending) {
    return NextResponse.json(
      { error: "Company signal scan is already in progress", code: "SIGNAL_SCAN_IN_PROGRESS" },
      { status: 409 },
    );
  }
  const result = await runTemplateViaRtx({
    templateId: template.id,
    config: { orgId: id },
    signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
  });
  if (!result.success) {
    const unavailable = result.errorCode === "standalone" || result.errorCode === "rtx_unavailable";
    return NextResponse.json(
      { error: unavailable ? "Company signal scans are available inside RealTimeX" : result.error, code: unavailable ? "RTX_UNAVAILABLE" : result.errorCode },
      { status: unavailable ? 503 : result.httpStatus },
    );
  }
  logOrgActivity({
    orgId: id,
    activityType: "workflow_started",
    title: "Company signal scan started",
    source: "system:start_signal_scan",
    workflowRunId: result.workflowRunId,
    dedupeKey: `workflow_started:${result.workflowRunId}`,
  });
  return NextResponse.json(
    { workflowRunId: result.workflowRunId, threadPath: result.threadPath },
    { status: 202 },
  );
}
