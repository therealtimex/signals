import { NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import { openRtxRuntimeLauncher } from "@/lib/rtx/runtime-sessions";

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

  const { workspaceSlug, threadSlug } = getRtxRefsFromRunConfig(run.config);
  if (!workspaceSlug || !threadSlug) {
    return NextResponse.json(
      { success: false, error: "This run has no RTX thread reference" },
      { status: 400 }
    );
  }

  const opened = await openRtxRuntimeLauncher({
    workspaceSlug,
    threadSlug,
    reason: `Open workflow run ${run.id}`,
  });

  return NextResponse.json({
    success: opened.success,
    threadPath: `/workspace/${workspaceSlug}/t/${threadSlug}`,
    workspaceSlug,
    threadSlug,
    error: opened.error,
  });
}
