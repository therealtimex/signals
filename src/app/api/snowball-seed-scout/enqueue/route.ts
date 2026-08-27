import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readSnowballSeedScoutDeployment } from "@/lib/rtx/deploy-snowball-seed-scout";
import { enqueueSnowballCalendarSeeds } from "@/lib/rtx/enqueue-snowball-calendar-seeds";
import { filterSnowballEnqueueUrls } from "@/lib/rtx/snowball-seed-url-filter";

/** Generous headroom over the scout's own 20-link ceiling. */
const MAX_ENQUEUE_URLS = 50;

const enqueueSchema = z.object({
  // The scout is slider-capped at 20 links per run. This route is
  // unauthenticated, so bound the list rather than letting a caller size the
  // batch — and the work it fans out into.
  urls: z.array(z.string().min(1)).min(1).max(MAX_ENQUEUE_URLS),
  platform: z.string().optional(),
  producerRunId: z.string().optional(),
});

/**
 * POST /api/snowball-seed-scout/enqueue
 * Called by the workspace scout shell script after URL harvest.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = enqueueSchema.parse(body);

    const deploymentResult = await readSnowballSeedScoutDeployment();
    if (!deploymentResult.success) {
      return NextResponse.json({ error: deploymentResult.error }, { status: 500 });
    }
    if (!deploymentResult.deployment || !deploymentResult.deployment.enabled) {
      return NextResponse.json(
        { error: "Snowball Seed Scout is not deployed" },
        { status: 409 },
      );
    }

    const { accepted, rejected } = filterSnowballEnqueueUrls(
      data.urls,
      data.platform ?? null,
    );

    if (accepted.length === 0) {
      return NextResponse.json({
        queued: 0,
        skipped: rejected.length,
        deduped: 0,
        failed: 0,
        deferred: 0,
        items: [],
        skippedUrls: [],
        dedupedUrls: [],
        failures: [],
        deferredUrls: [],
        rejectedNonPostUrls: rejected,
        message: "No enqueueable post URLs — navigation/search/home pages are not queued as Snowball seeds",
      });
    }

    const result = await enqueueSnowballCalendarSeeds(
      accepted.map((url) => ({
        url,
        platform: data.platform ?? null,
        producerRunId: data.producerRunId ?? null,
      })),
      deploymentResult.deployment,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // A seed the calendar API rejected is dropped, not retried, so the scout must
    // not read the run as clean. Surface failures explicitly, and fail the whole
    // request when nothing at all made it onto the calendar.
    const payload = {
      queued: result.queued.length,
      skipped: result.skipped.length + rejected.length,
      deduped: result.deduped.length,
      failed: result.failed.length,
      deferred: result.deferred.length,
      items: result.queued,
      skippedUrls: result.skipped,
      dedupedUrls: result.deduped,
      failures: result.failed,
      deferredUrls: result.deferred,
      rejectedNonPostUrls: rejected,
    };

    if (
      result.failed.length > 0 &&
      result.queued.length === 0 &&
      result.deferred.length === 0
    ) {
      return NextResponse.json(
        { ...payload, error: "All Snowball seeds failed to enqueue" },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
