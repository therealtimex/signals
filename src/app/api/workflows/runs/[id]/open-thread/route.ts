import { NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { openRtxRuntimeLauncher } from "@/lib/rtx/runtime-sessions";
import { getWorkflowRunAgentThreadTarget } from "@/lib/workflows/workflow-run-agent-thread";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/runs/[id]/open-thread
 * Focus RealTimeX on the RTX thread associated with a workflow run.
 */
export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const run = getWorkflowRun(id);
  if (!run) {
    return NextResponse.json({ success: false, error: "Workflow run not found" }, { status: 404 });
  }

  const target = getWorkflowRunAgentThreadTarget(run);
  if (!target) {
    return NextResponse.json(
      { success: false, error: "This run has no RTX thread reference" },
      { status: 400 }
    );
  }

  const opened = await openRtxRuntimeLauncher({
    workspaceSlug: target.workspaceSlug,
    threadSlug: target.threadSlug,
    presentationMode: "tab",
    reason: `Open workflow run ${run.id}`,
  });

  return NextResponse.json({
    success: opened.success,
    threadPath: target.threadPath,
    workspaceSlug: target.workspaceSlug,
    threadSlug: target.threadSlug,
    error: opened.error,
  });
}
