import { NextResponse } from "next/server";
import { getPublishJobById } from "@/lib/db/queries/publish-jobs";

type RouteContext = { params: Promise<{ id: string }> };

function serializeJob(job: NonNullable<ReturnType<typeof getPublishJobById>>) {
  return {
    id: job.id,
    contentItemId: job.contentItemId,
    status: job.status,
    targets: job.targetsParsed,
    payload: job.payloadParsed,
    rtxWorkspaceSlug: job.rtxWorkspaceSlug,
    rtxThreadSlug: job.rtxThreadSlug,
    rtxRuntimeSessionId: job.rtxRuntimeSessionId,
    error: job.error,
    errorCode: job.errorCode,
    stale: job.stale ?? false,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    threadPath:
      job.rtxWorkspaceSlug && job.rtxThreadSlug
        ? `/workspace/${job.rtxWorkspaceSlug}/t/${job.rtxThreadSlug}`
        : null,
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getPublishJobById(id);
  if (!job) {
    return NextResponse.json({ success: false, error: "Publish job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, job: serializeJob(job) });
}
