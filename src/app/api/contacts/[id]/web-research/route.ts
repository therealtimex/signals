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
import { releaseLostWorkflowDispatch } from "@/lib/rtx/workflow-run-terminal-watchdog";
import { notFoundResponse } from "@/lib/api/errors";

/**
 * Research state, after failing a run that was lost in dispatch (#572). Polling clients and the
 * re-run guard both see `failed`/`dispatch_lost` as soon as the liveness window has passed, without
 * waiting for the background sweep. The state is read again after the check whatever it decided:
 * the check may wait on RTX, and a completion that lands meanwhile must not be answered as pending.
 */
async function getLiveContactWebResearchState(contactId: string) {
  const state = getContactWebResearchState(contactId);
  if (state.status !== "pending" || !state.workflowRunId) return state;
  await releaseLostWorkflowDispatch(state.workflowRunId);
  return getContactWebResearchState(contactId);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getContactById(id)) return notFoundResponse("Contact not found");
  return NextResponse.json(await getLiveContactWebResearchState(id));
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
  const state = await getLiveContactWebResearchState(id);
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
    // `standalone` means Signals is not running inside RealTimeX; `rtx_unavailable` now only means
    // RealTimeX could not be reached for runtime sessions at all. Every other dispatch failure —
    // including one caused by the previous run's bad handoff — keeps its own code (#572).
    const standalone = result.errorCode === "standalone";
    const unavailable = standalone || result.errorCode === "rtx_unavailable";
    const researchTargetUnavailable = result.errorCode === "research_target_unavailable";
    return NextResponse.json(
      {
        error: standalone ? "Contact web research is available inside RealTimeX" : result.error,
        code: unavailable
          ? "RTX_UNAVAILABLE"
          : researchTargetUnavailable
            ? "RESEARCH_TARGET_UNAVAILABLE"
            : result.errorCode,
        details: {
          ...(result.details ?? {}),
          workflowRunId: result.workflowRunId ?? null,
        },
      },
      { status: unavailable ? 503 : researchTargetUnavailable ? 409 : result.httpStatus },
    );
  }

  return NextResponse.json(
    { workflowRunId: result.workflowRunId, threadPath: result.threadPath },
    { status: 202 },
  );
}
