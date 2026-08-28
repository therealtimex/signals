import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { getOrgEnrichmentState } from "@/lib/orgs/enrichment";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";
import { notFoundResponse } from "@/lib/api/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return notFoundResponse("Company not found");

  seedTemplates();
  const state = getOrgEnrichmentState(id);
  if (state.status === "pending") {
    return NextResponse.json(
      {
        error: "Company enrichment is already in progress",
        code: "ENRICHMENT_IN_PROGRESS",
        details: { workflowRunId: state.workflowRunId },
      },
      { status: 409 },
    );
  }

  const template = getSystemTemplateByName(COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME)!;
  const result = await runTemplateViaRtx({
    templateId: template.id,
    config: { orgId: id },
    signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
  });
  if (!result.success) {
    const unavailable = result.errorCode === "standalone" || result.errorCode === "rtx_unavailable";
    return NextResponse.json(
      {
        error: unavailable ? "Company enrichment is available inside RealTimeX" : result.error,
        code: unavailable ? "RTX_UNAVAILABLE" : result.errorCode,
        details: { workflowRunId: result.workflowRunId ?? null },
      },
      { status: unavailable ? 503 : result.httpStatus },
    );
  }

  return NextResponse.json(
    { workflowRunId: result.workflowRunId, threadPath: result.threadPath },
    { status: 202 },
  );
}
