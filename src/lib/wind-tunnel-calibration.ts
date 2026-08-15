import type { ContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import type { serializeCalibration } from "@/lib/db/queries/calibrations";

export type CalibrationMetricRow = {
  metric: string;
  predicted: number | null;
  actual: number | null;
  error: number | null;
};

export type CalibrationDto = ReturnType<typeof serializeCalibration>;

export function buildCalibrationRows(
  calibration: CalibrationDto,
  predictedMetrics?: Record<string, unknown>,
): CalibrationMetricRow[] {
  const calibrationJson = calibration.calibration ?? {};
  const predictedScore =
    typeof calibrationJson.predictedScore === "number" ? calibrationJson.predictedScore : null;
  const metricComparisons = calibrationJson.metricComparisons as
    | Record<string, { predicted?: number; actual?: number; error?: number }>
    | undefined;

  const rows: CalibrationMetricRow[] = [
    {
      metric: "score",
      predicted: predictedScore,
      actual: calibration.actualScore,
      error: calibration.scoreError,
    },
  ];

  if (metricComparisons && typeof metricComparisons === "object") {
    for (const metric of Object.keys(metricComparisons).sort()) {
      const triple = metricComparisons[metric];
      if (!triple || typeof triple !== "object") continue;
      rows.push({
        metric,
        predicted: typeof triple.predicted === "number" ? triple.predicted : null,
        actual: typeof triple.actual === "number" ? triple.actual : null,
        error: typeof triple.error === "number" ? triple.error : null,
      });
    }
    return rows;
  }

  const predictedRecord = predictedMetrics ?? {};
  const actualMetrics = calibration.actualMetrics ?? {};
  const metricKeys = new Set([...Object.keys(predictedRecord), ...Object.keys(actualMetrics)]);
  for (const metric of [...metricKeys].sort()) {
    const predicted =
      typeof predictedRecord[metric] === "number" ? (predictedRecord[metric] as number) : null;
    const actual = typeof actualMetrics[metric] === "number" ? actualMetrics[metric] : null;
    rows.push({
      metric,
      predicted,
      actual,
      error: predicted != null && actual != null ? actual - predicted : null,
    });
  }

  return rows;
}

export function buildCalibrationMetricRows(
  gtm: Pick<ContentGtmContext, "latestRun" | "latestCalibration">,
): CalibrationMetricRow[] {
  if (!gtm.latestRun || !gtm.latestCalibration) return [];

  const predictedMetrics = gtm.latestRun.predictedMetrics ?? {};
  const actualMetrics = gtm.latestCalibration.actualMetrics ?? {};
  const rows: CalibrationMetricRow[] = [
    {
      metric: "score",
      predicted: gtm.latestRun.predictedScore,
      actual: gtm.latestCalibration.actualScore,
      error: gtm.latestCalibration.scoreError,
    },
  ];

  const metricKeys = new Set([
    ...Object.keys(predictedMetrics),
    ...Object.keys(actualMetrics),
  ]);
  for (const metric of [...metricKeys].sort()) {
    const predicted =
      typeof predictedMetrics[metric] === "number" ? predictedMetrics[metric] : null;
    const actual = typeof actualMetrics[metric] === "number" ? actualMetrics[metric] : null;
    rows.push({
      metric,
      predicted,
      actual,
      error: predicted != null && actual != null ? actual - predicted : null,
    });
  }

  return rows;
}
