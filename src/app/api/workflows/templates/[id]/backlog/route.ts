import { NextResponse } from "next/server";
import {
  countProfilePipelineBacklog,
  resolveProfilePipelineFilters,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { getValidatedPipelineFromTemplate } from "@/lib/workflows/pipeline/validate-pipeline-config";

/**
 * GET /api/workflows/templates/[id]/backlog
 * Backlog preview for pipeline templates (§8.1).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const template = getTemplate(id);
  if (!template) {
    return NextResponse.json(
      { error: "Template not found", errorCode: "not_found" },
      { status: 404 },
    );
  }

  const pipelineValidation = getValidatedPipelineFromTemplate(template.config);
  if (!pipelineValidation.success) {
    return NextResponse.json(
      { error: "Template is not a pipeline", errorCode: "NOT_A_PIPELINE" },
      { status: 404 },
    );
  }

  const pipeline = pipelineValidation.pipeline;
  const filters = resolveProfilePipelineFilters(pipeline.filters);

  return NextResponse.json({
    backlogTotal: countProfilePipelineBacklog(filters),
    batchSize: pipeline.batchSize ?? 20,
    filters,
  });
}
