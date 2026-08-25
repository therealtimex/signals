import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readSnowballSeedScoutDeployment } from "@/lib/rtx/deploy-snowball-seed-scout";
import { enqueueSnowballCalendarSeeds } from "@/lib/rtx/enqueue-snowball-calendar-seeds";

const enqueueSchema = z.object({
  urls: z.array(z.string().min(1)).min(1),
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
    if (!deploymentResult.deployment) {
      return NextResponse.json(
        { error: "Snowball Seed Scout is not deployed" },
        { status: 409 },
      );
    }

    const result = await enqueueSnowballCalendarSeeds(
      data.urls.map((url) => ({
        url,
        platform: data.platform ?? null,
        producerRunId: data.producerRunId ?? null,
      })),
      deploymentResult.deployment,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      queued: result.queued.length,
      skipped: result.skipped.length,
      items: result.queued,
      skippedUrls: result.skipped,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
