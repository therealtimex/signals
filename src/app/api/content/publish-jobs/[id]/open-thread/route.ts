import { NextResponse } from "next/server";
import { getPublishJobById } from "@/lib/db/queries/publish-jobs";
import { openRtxRuntimeLauncher } from "@/lib/rtx/runtime-sessions";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getPublishJobById(id);
  if (!job) {
    return NextResponse.json({ success: false, error: "Publish job not found" }, { status: 404 });
  }
  if (!job.rtxWorkspaceSlug || !job.rtxThreadSlug) {
    return NextResponse.json(
      { success: false, error: "This job has no RTX thread reference" },
      { status: 400 }
    );
  }

  const opened = await openRtxRuntimeLauncher({
    workspaceSlug: job.rtxWorkspaceSlug,
    threadSlug: job.rtxThreadSlug,
    reason: `Open publish job ${job.id}`,
  });

  return NextResponse.json({
    success: opened.success,
    threadPath: `/workspace/${job.rtxWorkspaceSlug}/t/${job.rtxThreadSlug}`,
    error: opened.error,
  });
}
