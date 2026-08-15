import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Launch, SimulationRun } from "@/lib/db/types";
import type { Variant } from "@/lib/db/types";
import type { serializeCalibration } from "@/lib/db/queries/calibrations";
import { formatLaunchDate, parseAudienceSpec } from "@/lib/launches-display";
import {
  buildCalibrationRows,
  type CalibrationMetricRow,
} from "@/lib/wind-tunnel-calibration";
import { RunAgentsTable, type RunAgentRow } from "./run-agents-table";
import { getVariantDetailHref } from "../../launches/[id]/variants/[variantId]/variant-run-timeline-utils";

type CalibrationDto = ReturnType<typeof serializeCalibration>;

const RUN_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

function formatMetricValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function formatScoreError(scoreError: number): string {
  const prefix = scoreError >= 0 ? "+" : "";
  return `${prefix}${scoreError.toFixed(2)}`;
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function PopulationSpecSummary({ populationSpecRaw }: { populationSpecRaw: string | null }) {
  const populationSpec = parseAudienceSpec(populationSpecRaw);
  const nicheIds = Array.isArray(populationSpec.nicheIds)
    ? populationSpec.nicheIds.filter((id): id is string => typeof id === "string")
    : [];
  const sampleSize =
    typeof populationSpec.sampleSize === "number" ? populationSpec.sampleSize : null;
  const remaining = Object.fromEntries(
    Object.entries(populationSpec).filter(([key]) => key !== "nicheIds" && key !== "sampleSize"),
  );

  if (Object.keys(populationSpec).length === 0) {
    return <p className="text-sm text-muted-foreground">No population spec.</p>;
  }

  return (
    <div className="space-y-2 text-sm">
      {sampleSize != null && <p>Sample size: {sampleSize}</p>}
      {nicheIds.length > 0 && <p>{nicheIds.length} niche(s)</p>}
      {Object.keys(remaining).length > 0 && (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(remaining, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CalibrationTable({ rows }: { rows: CalibrationMetricRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Predicted</TableHead>
            <TableHead>Actual</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.metric}>
              <TableCell>{row.metric}</TableCell>
              <TableCell>{formatMetricValue(row.predicted)}</TableCell>
              <TableCell>{formatMetricValue(row.actual)}</TableCell>
              <TableCell>{formatMetricValue(row.error)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CalibrationPanel({
  run,
  variant,
  calibrations,
}: {
  run: SimulationRun;
  variant?: Variant;
  calibrations: CalibrationDto[];
}) {
  if (run.status !== "completed") {
    return (
      <p className="text-sm text-muted-foreground">Calibration runs against completed runs only.</p>
    );
  }

  if (calibrations.length === 0) {
    const emptyCopy =
      variant?.status !== "published"
        ? "Calibration starts after this variant is published."
        : "No calibration yet — actuals are compared after the observation window.";
    return <p className="text-sm text-muted-foreground">{emptyCopy}</p>;
  }

  const predictedMetrics = parseJsonRecord(run.predictedMetrics);

  return (
    <div className="space-y-6">
      {calibrations.map((calibration, index) => {
        const rows = buildCalibrationRows(calibration, predictedMetrics);
        return (
          <div key={calibration.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                Observed until {formatLaunchDate(calibration.observedUntil)}
              </p>
              {index === 0 && <Badge variant="secondary">Latest</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              window {formatLaunchDate(calibration.observedFrom)} →{" "}
              {formatLaunchDate(calibration.observedUntil)} · computed{" "}
              {formatLaunchDate(calibration.computedAt)} · score error{" "}
              {formatScoreError(calibration.scoreError ?? 0)}
            </p>
            <CalibrationTable rows={rows} />
          </div>
        );
      })}
    </div>
  );
}

interface RunDetailViewProps {
  run: SimulationRun;
  agents: RunAgentRow[];
  calibrations: CalibrationDto[];
  variant?: Variant;
  launch?: Launch;
}

export function RunDetailView({
  run,
  agents,
  calibrations,
  variant,
  launch,
}: RunDetailViewProps) {
  const variantHref =
    variant && launch ? getVariantDetailHref(launch.id, variant.id) : "/dashboard/launches";
  const backLabel = variant?.label ?? "Untitled";
  const shortId = run.id.length > 10 ? `${run.id.slice(0, 8)}…` : run.id;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-3">
        <Link
          href={variantHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {backLabel}
        </Link>
        <div className="space-y-2">
          <h1 className="text-heading-1">
            Simulation run <span className="font-mono text-base">{shortId}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={RUN_STATUS_VARIANTS[run.status] ?? "outline"}>{run.status}</Badge>
            <Badge variant="outline">{run.source}</Badge>
            {run.batchId && <Badge variant="outline">{run.batchId}</Badge>}
            {launch?.scope === "local_only" && (
              <Badge variant="outline">Private launch</Badge>
            )}
          </div>
          {variant && launch && (
            <p className="text-sm text-muted-foreground">
              <Link href={`/dashboard/launches/${launch.id}`} className="hover:underline">
                {launch.name}
              </Link>
              {" · "}
              <Link href={variantHref} className="hover:underline">
                {variant.label ?? "Untitled"}
              </Link>
            </p>
          )}
        </div>
      </div>

      {(run.status === "failed" || run.status === "cancelled") && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Run {run.status}</p>
          <p className="mt-1 text-muted-foreground">
            {run.error ?? "No error message was recorded."}
          </p>
        </div>
      )}

      {(run.status === "pending" || run.status === "running") && (
        <p className="text-sm text-muted-foreground">
          This run is still in progress — results appear as the terminal agent records them.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aggregates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Predicted score:{" "}
            {run.predictedScore != null ? run.predictedScore.toFixed(2) : "—"}
            {run.predictionConfidence != null &&
              ` (${(run.predictionConfidence * 100).toFixed(0)}% confidence)`}
          </p>
          <p>Prediction model: {run.predictionModel ?? "—"}</p>
          <p>Agent count: {run.agentCount}</p>
          <div>
            <p className="font-medium">Population spec</p>
            <PopulationSpecSummary populationSpecRaw={run.populationSpec} />
          </div>
          <p>Started: {formatLaunchDate(run.startedAt)}</p>
          <p>Completed: {formatLaunchDate(run.completedAt)}</p>
          {run.workflowRunId && (
            <p>
              Workflow run: <span className="font-mono text-xs">{run.workflowRunId}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent results</CardTitle>
        </CardHeader>
        <CardContent>
          <RunAgentsTable
            runId={run.id}
            agents={agents}
            transcriptsPrunedAt={run.transcriptsPrunedAt}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <CalibrationPanel run={run} variant={variant} calibrations={calibrations} />
        </CardContent>
      </Card>
    </div>
  );
}
