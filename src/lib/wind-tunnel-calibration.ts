import type { ContentGtmContext } from "@/lib/db/queries/content-gtm-context";

export type CalibrationMetricRow = {
  metric: string;
  predicted: number | null;
  actual: number | null;
  error: number | null;
};

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
