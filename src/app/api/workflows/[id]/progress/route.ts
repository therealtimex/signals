import { NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { summarizeWorkflowRunProposals } from "@/lib/writing/workflow-run-proposals";

/**
 * GET /api/workflows/[id]/progress
 * Poll the progress of a running workflow.
 * Returns the run, all steps, and completion status.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = getWorkflowRun(id);

  if (!run) {
    return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  }

  const isComplete = ["completed", "failed", "cancelled"].includes(run.status);

  return NextResponse.json({
    run: {
      id: run.id,
      workflowType: run.workflowType,
      status: run.status,
      totalItems: run.totalItems,
      processedItems: run.processedItems,
      successItems: run.successItems,
      skippedItems: run.skippedItems,
      errorItems: run.errorItems,
      model: run.model,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      config: run.config,
      errors: run.errors,
      result: run.result,
    },
    steps: run.steps,
    isComplete,
    totalSteps: run.steps.length,
    proposalSummary: summarizeWorkflowRunProposals(id),
  });
}
