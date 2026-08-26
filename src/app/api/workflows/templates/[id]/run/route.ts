import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import { runPipelineTemplate } from "@/lib/workflows/pipeline/run-pipeline-template";
import { isHeartbeatShellTemplateConfig } from "@/lib/workflows/snowball-seed-scout";

const runSchema = z.object({
  config: z.record(z.unknown()).optional(),
  systemPrompt: z.string().optional(),
  /** Opt out of the template's dedicated thread for this run only. */
  freshThread: z.boolean().optional(),
});

/**
 * POST /api/workflows/templates/[id]/run
 * Agent templates launch via RTX; pipeline templates run in-process with thread attachment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const data = runSchema.parse(body);

    const template = getTemplate(id);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found", errorCode: "not_found" },
        { status: 404 },
      );
    }

    const templateConfig = parseTemplateConfig(template.config);
    // Heartbeat-shell templates are provisioned via Deploy, not launched as a
    // terminal-agent run. Running one through RTX would do nothing useful.
    if (isHeartbeatShellTemplateConfig(templateConfig)) {
      return NextResponse.json(
        {
          error:
            "This template is deployed to the RealTimeX workspace heartbeat and cannot be run directly. Use Deploy instead.",
          errorCode: "deploy_only_template",
        },
        { status: 400 },
      );
    }

    if (templateConfig.pipeline) {
      const result = await runPipelineTemplate({
        templateId: id,
        input: data.config,
        trigger: "template",
        freshThread: data.freshThread,
      });

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error,
            errorCode: result.errorCode,
            details: result.details,
          },
          { status: result.httpStatus },
        );
      }

      return NextResponse.json(
        {
          workflowRunId: result.workflowRunId,
          workflowRun: result.workflowRun,
          plan: result.plan,
          threadPath: result.threadPath,
        },
        { status: 201 },
      );
    }

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
        { status: result.httpStatus },
      );
    }

    return NextResponse.json(
      {
        workflowRunId: result.workflowRunId,
        workflowRun: result.workflowRun,
        workspaceSlug: result.workspaceSlug,
        threadSlug: result.threadSlug,
        threadPath: result.threadPath,
        threadResolution: result.threadResolution,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", errorCode: "VALIDATION_ERROR", details: error.flatten() },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
