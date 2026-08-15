import type { ContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { buildCalibrationMetricRows } from "@/lib/wind-tunnel-calibration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatMetricValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface WindTunnelSectionProps {
  gtm: ContentGtmContext;
}

export function WindTunnelSection({ gtm }: WindTunnelSectionProps) {
  const { variant, launch, latestRun, latestCalibration } = gtm;
  const calibrationRows = buildCalibrationMetricRows(gtm);

  let emptyCopy: string | null = null;
  if (!variant) {
    emptyCopy =
      "Not part of a GTM launch yet. Create a variant from a launch to see Wind Tunnel projections.";
  } else if (!latestRun) {
    emptyCopy = "No completed simulation runs yet. Run the Wind Tunnel from your terminal agent.";
  } else if (!latestCalibration) {
    emptyCopy =
      variant.status === "published"
        ? "No calibration yet — actuals are compared after the observation window."
        : "Calibration starts after this variant is published.";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wind Tunnel</CardTitle>
        {variant && launch && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <a href="#" title="Launch detail coming soon" className="font-medium text-foreground hover:underline">
              {launch.name}
            </a>
            <Badge variant="secondary">{launch.status}</Badge>
            {launch.scope === "local_only" && <Badge variant="outline">Private launch</Badge>}
            {variant.label && <span>· {variant.label}</span>}
            <Badge variant="outline">{variant.status}</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {emptyCopy && <p className="text-sm text-muted-foreground">{emptyCopy}</p>}

        {variant && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">Projected</p>
            {variant.predictedScore != null ? (
              <div className="text-muted-foreground space-y-0.5">
                <p>
                  Score {variant.predictedScore.toFixed(2)}
                  {variant.predictionConfidence != null &&
                    ` · ${(variant.predictionConfidence * 100).toFixed(0)}% confidence`}
                </p>
                {variant.predictionModel && <p>Model: {variant.predictionModel}</p>}
                {variant.simulatedAt && <p>Simulated: {formatDate(variant.simulatedAt)}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">Not simulated yet.</p>
            )}
          </div>
        )}

        {latestCalibration && calibrationRows.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Calibration</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">Metric</th>
                    <th className="py-1 pr-4 font-medium">Predicted</th>
                    <th className="py-1 pr-4 font-medium">Actual</th>
                    <th className="py-1 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {calibrationRows.map((row) => (
                    <tr key={row.metric} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-4">{row.metric}</td>
                      <td className="py-1.5 pr-4">{formatMetricValue(row.predicted)}</td>
                      <td className="py-1.5 pr-4">{formatMetricValue(row.actual)}</td>
                      <td className="py-1.5">{formatMetricValue(row.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Observation window: {formatDate(latestCalibration.observedFrom)} →{" "}
              {formatDate(latestCalibration.observedUntil)} · Computed{" "}
              {formatDate(latestCalibration.computedAt)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
