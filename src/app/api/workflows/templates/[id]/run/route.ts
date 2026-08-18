import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";

const runSchema = z.object({
  config: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
});

/**
 * POST /api/workflows/templates/[id]/run
 * Provision an RTX workspace thread and launch a terminal agent with the template brief.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const data = runSchema.parse(body);
    const result = await runTemplateViaRtx({
      templateId: id,
      config: data.config,
      systemPrompt: data.systemPrompt,
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
        workflowRunId: result.workflowRunId,
        workflowRun: result.workflowRun,
        workspaceSlug: result.workspaceSlug,
        threadSlug: result.threadSlug,
        threadPath: result.threadPath,
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
