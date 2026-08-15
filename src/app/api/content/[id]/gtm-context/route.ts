import { NextRequest, NextResponse } from "next/server";
import { getContentItem } from "@/lib/db/queries/content";
import { getLaunchById } from "@/lib/db/queries/launches";
import { getVariantByContentItemId } from "@/lib/db/queries/variants";
import {
  getLatestCalibrationForRun,
  serializeCalibration,
} from "@/lib/db/queries/calibrations";
import { listSimulationRuns } from "@/lib/db/queries/simulations";
import { notFoundResponse } from "@/lib/api/errors";
import { serializeSimulationRun, serializeVariant } from "@/lib/serializers/gtm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contentItemId } = await params;
  const content = getContentItem(contentItemId);
  if (!content) {
    return notFoundResponse("Content item not found");
  }

  const variant = getVariantByContentItemId(contentItemId);
  const launch = variant ? getLaunchById(variant.launchId) : null;

  let latestRun = null;
  let latestCalibration = null;

  if (variant) {
    const runs = listSimulationRuns({
      variantId: variant.id,
      status: "completed",
      page: 1,
      pageSize: 1,
    });
    if (runs.data[0]) {
      latestRun = serializeSimulationRun(runs.data[0]);
      const calibrationRow = getLatestCalibrationForRun(runs.data[0].id);
      if (calibrationRow) {
        latestCalibration = serializeCalibration(calibrationRow);
      }
    }
  }

  return NextResponse.json({
    contentItemId,
    variant: variant ? serializeVariant(variant) : null,
    launch: launch
      ? {
          id: launch.id,
          name: launch.name,
          status: launch.status,
          scope: launch.scope,
        }
      : null,
    latestRun,
    latestCalibration,
  });
}
