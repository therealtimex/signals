import Link from "next/link";
import { Wind } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import type { Launch } from "@/lib/db/types";
import type { Variant } from "@/lib/db/types";
import type { SimulationRun } from "@/lib/db/types";
import { formatLaunchDate } from "@/lib/launches-display";
import { VariantRunTimeline } from "./variant-run-timeline";
import { VariantRunsPagination } from "./variant-runs-pagination";

const VARIANT_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  published: "default",
  archived: "outline",
};

const RUN_TIMELINE_CTA =
  "Runs live in your terminal agent — ask it to run the Wind Tunnel on this variant. The dashboard is read-only.";

interface VariantDetailViewProps {
  launch: Launch;
  variant: Variant;
  runs: SimulationRun[];
  runsTotal: number;
  runsPage: number;
  runsPageSize: number;
  projectionSourceRunId: string | null;
}

function parsePredictedMetrics(raw: string | null | undefined): Record<string, unknown> {
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

export function VariantDetailView({
  launch,
  variant,
  runs,
  runsTotal,
  runsPage,
  runsPageSize,
  projectionSourceRunId,
}: VariantDetailViewProps) {
  const predictedMetrics = parsePredictedMetrics(variant.predictedMetrics);
  const hasCompletedRunOnPage = projectionSourceRunId != null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-3">
        <Link
          href={`/dashboard/launches/${launch.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {launch.name}
        </Link>
        <div className="space-y-2">
          <h1 className="text-heading-1">{variant.label ?? "Untitled"}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{variant.variantType}</Badge>
            <Badge variant={VARIANT_STATUS_VARIANTS[variant.status] ?? "outline"}>
              {variant.status}
            </Badge>
            {launch.scope === "local_only" && <Badge variant="outline">Private launch</Badge>}
          </div>
          {(variant.predictionModel || variant.simulatedAt) && (
            <p className="text-sm text-muted-foreground">
              {variant.predictionModel && <>Model: {variant.predictionModel}</>}
              {variant.predictionModel && variant.simulatedAt && " · "}
              {variant.simulatedAt && <>Simulated {formatLaunchDate(variant.simulatedAt)}</>}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Body</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {variant.body ? (
            <p className="whitespace-pre-wrap text-sm">{variant.body}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No body yet. Edit this variant from the launch board.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {variant.generationModel && <span>Generated with {variant.generationModel}</span>}
            {variant.contentItemId && (
              <Link
                href={`/dashboard/content/${variant.contentItemId}`}
                className="hover:underline text-foreground"
              >
                View post →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Projection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {variant.predictedScore != null ? (
            <div className="space-y-2 text-muted-foreground">
              <p>
                Score {variant.predictedScore.toFixed(2)}
                {variant.predictionConfidence != null &&
                  ` · ${(variant.predictionConfidence * 100).toFixed(0)}% confidence`}
              </p>
              {variant.predictionModel && <p>Model: {variant.predictionModel}</p>}
              {variant.simulatedAt && <p>Simulated: {formatLaunchDate(variant.simulatedAt)}</p>}
              {Object.keys(predictedMetrics).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(predictedMetrics).map(([key, value]) => (
                    <p key={key}>
                      <span className="font-medium text-foreground">{key}</span>:{" "}
                      {typeof value === "number" ? value.toFixed(2) : String(value)}
                    </p>
                  ))}
                </div>
              )}
              {hasCompletedRunOnPage && (
                <p>Projected from the latest completed run below.</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Not simulated yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Simulation runs
            {runsTotal > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({runsTotal})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{RUN_TIMELINE_CTA}</p>
          {runs.length === 0 ? (
            <EmptyState
              icon={Wind}
              mood="sleepy"
              title="No simulation runs yet"
              description={RUN_TIMELINE_CTA}
            />
          ) : (
            <>
              <VariantRunTimeline
                runs={runs}
                projectionSourceRunId={projectionSourceRunId}
              />
              <VariantRunsPagination
                launchId={launch.id}
                variantId={variant.id}
                page={runsPage}
                pageSize={runsPageSize}
                total={runsTotal}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
