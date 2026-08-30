import { NextRequest, NextResponse } from "next/server";
import { getContactById, isContactArchived } from "@/lib/db/queries/contacts";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_WEB_RESEARCH_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { getContactWebResearchState } from "@/lib/contacts/web-research-state";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";
import { notFoundResponse } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getContactById(id)) return notFoundResponse("Contact not found");
  return NextResponse.json(getContactWebResearchState(id));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const contact = getContactById(id);
  if (!contact) return notFoundResponse("Contact not found");
  if (contact.isSelf || isContactArchived(contact.metadata)) {
    return NextResponse.json(
      {
        error: "Web research is disabled for self or archived contacts",
        code: "CONTACT_ENRICHMENT_DISABLED",
      },
      { status: 409 },
    );
  }

  seedTemplates();
  const state = getContactWebResearchState(id);
  if (state.status === "pending") {
    return NextResponse.json(
      {
        error: "Contact web research is already in progress",
        code: "ENRICHMENT_IN_PROGRESS",
        details: { workflowRunId: state.workflowRunId },
      },
      { status: 409 },
    );
  }

  const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
  const result = await runTemplateViaRtx({
    templateId: template.id,
    config: { contactId: id },
    signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
  });
  if (!result.success) {
    const unavailable = result.errorCode === "standalone" || result.errorCode === "rtx_unavailable";
    return NextResponse.json(
      {
        error: unavailable ? "Contact web research is available inside RealTimeX" : result.error,
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
