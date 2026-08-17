import { NextResponse } from "next/server";
import { listPublishJobsForContentItem } from "@/lib/db/queries/publish-jobs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contentItemId = searchParams.get("contentItemId")?.trim();
  if (!contentItemId) {
    return NextResponse.json(
      { success: false, error: "contentItemId query parameter is required" },
      { status: 400 }
    );
  }

  const jobs = listPublishJobsForContentItem(contentItemId).map((job) => ({
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
  }));

  return NextResponse.json({ success: true, jobs });
}
