import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";

const activateSchema = z.object({
  config: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
  /** Opt out of the template's dedicated thread for this run only. */
  freshThread: z.boolean().optional(),
});

/**
 * POST /api/workflows/templates/[id]/activate
 * @deprecated Use POST /api/workflows/templates/[id]/run instead.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const template = getTemplate(id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const data = activateSchema.parse(body);

    const result = await runTemplateViaRtx({
      templateId: id,
      config: data.config,
      systemPrompt: data.systemPrompt,
      freshThread: data.freshThread,
      signalsBaseUrl: resolveSignalsBaseUrlFromRequest(req),
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          errorCode: result.errorCode,
          workflowRunId: result.workflowRunId,
        },
        { status: result.httpStatus }
      );
    }

    return NextResponse.json(
      {
        workflowRun: result.workflowRun,
        workflowRunId: result.workflowRunId,
        workspaceSlug: result.workspaceSlug,
        threadSlug: result.threadSlug,
        threadPath: result.threadPath,
        threadResolution: result.threadResolution,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
