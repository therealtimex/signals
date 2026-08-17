import { NextResponse } from "next/server";
import { markStalePublishJobFailed } from "@/lib/db/queries/publish-jobs";
import { getPublishJobById } from "@/lib/db/queries/publish-jobs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getPublishJobById(id);
  if (!job) {
    return NextResponse.json({ success: false, error: "Publish job not found" }, { status: 404 });
  }
  if (!job.stale) {
    return NextResponse.json(
      { success: false, error: "Only stale queued/publishing jobs can be marked failed" },
      { status: 400 }
    );
  }

  const updated = markStalePublishJobFailed(id);
  if (!updated) {
    return NextResponse.json({ success: false, error: "Failed to mark job failed" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    job: {
      id: updated.id,
      status: updated.status,
      targets: updated.targetsParsed,
      errorCode: updated.errorCode,
    },
  });
}
