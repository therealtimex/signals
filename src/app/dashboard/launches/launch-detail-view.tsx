"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LaunchWithDetails } from "@/lib/db/queries/launches";
import {
  formatLaunchDate,
  parseAudienceSpec,
  sortVariantsForBoard,
} from "@/lib/launches-display";

const PUBLISHED_VARIANT_TOOLTIP = "Published variants are read-only";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  generating: "secondary",
  simulating: "secondary",
  ready: "default",
  live: "default",
  completed: "secondary",
  archived: "outline",
};

export type LinkedGoalChip = {
  id: string;
  name: string;
};

interface LaunchDetailViewProps {
  launch: LaunchWithDetails;
  linkedGoals: LinkedGoalChip[];
  onEditLaunch?: () => void;
  onAddVariant?: () => void;
  onEditVariant?: (variantId: string) => void;
}

function AudienceSpecCard({ audienceSpecRaw }: { audienceSpecRaw: string | null }) {
  const audienceSpec = parseAudienceSpec(audienceSpecRaw);
  const nicheIds = Array.isArray(audienceSpec.nicheIds)
    ? audienceSpec.nicheIds.filter((id): id is string => typeof id === "string")
    : [];
  const sampleSize =
    typeof audienceSpec.sampleSize === "number" ? audienceSpec.sampleSize : null;
  const remaining = Object.fromEntries(
    Object.entries(audienceSpec).filter(([key]) => key !== "nicheIds" && key !== "sampleSize"),
  );

  if (Object.keys(audienceSpec).length === 0) {
    return <p className="text-sm text-muted-foreground">No audience spec yet.</p>;
  }

  return (
    <div className="space-y-3 text-sm">
      {nicheIds.length > 0 && (
        <div>
          <p className="font-medium">{nicheIds.length} niche(s)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {nicheIds.map((id) => (
              <code key={id} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {id}
              </code>
            ))}
          </div>
        </div>
      )}
      {sampleSize != null && <p>Sample size: {sampleSize}</p>}
      {Object.keys(remaining).length > 0 && (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(remaining, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LaunchDetailView({
  launch,
  linkedGoals,
  onEditLaunch,
  onAddVariant,
  onEditVariant,
}: LaunchDetailViewProps) {
  const sortedVariants = sortVariantsForBoard(launch.variants);

  return (
    <TooltipProvider>
      <div className="space-y-6 max-w-3xl">
      <div className="space-y-3">
        <Link href="/dashboard/launches" className="text-sm text-muted-foreground hover:text-foreground">
          ← Launches
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-heading-1">{launch.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANTS[launch.status] ?? "outline"}>{launch.status}</Badge>
              {launch.scope === "local_only" && <Badge variant="outline">Private</Badge>}
              {launch.primaryPlatform && (
                <Badge variant="outline">{launch.primaryPlatform}</Badge>
              )}
            </div>
            {(launch.launchedAt || launch.completedAt) && (
              <p className="text-sm text-muted-foreground">
                {launch.launchedAt && <>Launched {formatLaunchDate(launch.launchedAt)}</>}
                {launch.launchedAt && launch.completedAt && " · "}
                {launch.completedAt && <>Completed {formatLaunchDate(launch.completedAt)}</>}
              </p>
            )}
          </div>
          {onEditLaunch && (
            <Button variant="outline" onClick={onEditLaunch}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {launch.scope === "local_only" && (
        <div className="rounded-lg border border-muted-foreground/30 bg-muted/40 p-4 text-sm">
          <p className="font-medium">Private launch — Wind Tunnel simulation is blocked.</p>
          <p className="mt-1 text-muted-foreground">
            Simulations only run against shared launches. Set scope to Shared (Edit above, or via
            your terminal agent) to simulate variants.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brief</CardTitle>
        </CardHeader>
        <CardContent>
          {launch.brief ? (
            <p className="whitespace-pre-wrap text-sm">{launch.brief}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No brief yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience</CardTitle>
        </CardHeader>
        <CardContent>
          <AudienceSpecCard audienceSpecRaw={launch.audienceSpec} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked goals</CardTitle>
        </CardHeader>
        <CardContent>
          {linkedGoals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked goals. Link goals from your terminal agent.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {linkedGoals.map((goal) => (
                <Link key={goal.id} href={`/dashboard/goals/${goal.id}`}>
                  <Badge variant="secondary">{goal.name}</Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Variant board</CardTitle>
          {onAddVariant && (
            <Button size="sm" onClick={onAddVariant}>
              Add variant
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {sortedVariants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No variants yet. Add one here or generate variants with your terminal agent.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Predicted score</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Simulated</TableHead>
                  <TableHead>Content</TableHead>
                  {onEditVariant && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVariants.map((variant) => {
                  const isPublished = variant.status === "published";
                  return (
                    <TableRow key={variant.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/launches/${launch.id}/variants/${variant.id}`}
                            className="text-sm hover:underline"
                          >
                            {variant.label ?? "Untitled"}
                          </Link>
                          <Badge variant="outline" className="text-xs">
                            {variant.variantType}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{variant.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {variant.predictedScore != null
                          ? variant.predictedScore.toFixed(2)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {variant.predictionConfidence != null
                          ? `${(variant.predictionConfidence * 100).toFixed(0)}%`
                          : "—"}
                      </TableCell>
                      <TableCell>{formatLaunchDate(variant.simulatedAt)}</TableCell>
                      <TableCell>
                        {variant.contentItemId ? (
                          <Link
                            href={`/dashboard/content/${variant.contentItemId}`}
                            className="text-sm hover:underline"
                          >
                            View post →
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {onEditVariant && (
                        <TableCell>
                          {isPublished ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex"
                                  aria-label={PUBLISHED_VARIANT_TOOLTIP}
                                >
                                  <Button variant="ghost" size="sm" disabled>
                                    Edit
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{PUBLISHED_VARIANT_TOOLTIP}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditVariant(variant.id)}
                            >
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </div>
    </TooltipProvider>
  );
}
