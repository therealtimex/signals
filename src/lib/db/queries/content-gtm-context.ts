import { getContentItem } from "@/lib/db/queries/content";
import { getLaunchById } from "@/lib/db/queries/launches";
import { getVariantByContentItemId } from "@/lib/db/queries/variants";
import {
  getLatestCalibrationForRun,
  serializeCalibration,
} from "@/lib/db/queries/calibrations";
import { listSimulationRuns } from "@/lib/db/queries/simulations";
import { serializeSimulationRun, serializeVariant } from "@/lib/serializers/gtm";

export type ContentGtmLaunchSummary = {
  id: string;
  name: string;
  status: string;
  scope: string;
};

export type ContentGtmContext = {
  contentItemId: string;
  variant: ReturnType<typeof serializeVariant> | null;
  launch: ContentGtmLaunchSummary | null;
  latestRun: ReturnType<typeof serializeSimulationRun> | null;
  latestCalibration: ReturnType<typeof serializeCalibration> | null;
};

export function getContentGtmContext(contentItemId: string): ContentGtmContext | null {
  const content = getContentItem(contentItemId);
  if (!content) return null;

  const variant = getVariantByContentItemId(contentItemId);
  const launch = variant ? getLaunchById(variant.launchId) : null;

  let latestRun: ReturnType<typeof serializeSimulationRun> | null = null;
  let latestCalibration: ReturnType<typeof serializeCalibration> | null = null;

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

  return {
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
  };
}
