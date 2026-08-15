"use client";

import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SimulationRun } from "@/lib/db/types";
import { formatLaunchDate } from "@/lib/launches-display";
import {
  getSimulationDetailHref,
  isSimulationRowActivationKey,
} from "./variant-run-timeline-utils";

const RUN_STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

interface VariantRunTimelineProps {
  runs: SimulationRun[];
  projectionSourceRunId: string | null;
}

export function VariantRunTimeline({ runs, projectionSourceRunId }: VariantRunTimelineProps) {
  const router = useRouter();

  function navigateToRun(runId: string) {
    router.push(getSimulationDetailHref(runId));
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, runId: string) {
    if (!isSimulationRowActivationKey(event.key)) return;
    event.preventDefault();
    navigateToRun(runId);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Predicted score</TableHead>
          <TableHead>Agents</TableHead>
          <TableHead>Completed</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            className="cursor-pointer hover:bg-muted/50"
            tabIndex={0}
            role="link"
            aria-label={`Open simulation run ${run.id}`}
            onClick={() => navigateToRun(run.id)}
            onKeyDown={(event) => handleRowKeyDown(event, run.id)}
          >
            <TableCell>
              <Badge variant={RUN_STATUS_VARIANTS[run.status] ?? "outline"}>{run.status}</Badge>
            </TableCell>
            <TableCell>{run.predictionModel ?? "—"}</TableCell>
            <TableCell>
              {run.predictedScore != null ? run.predictedScore.toFixed(2) : "—"}
            </TableCell>
            <TableCell>{run.agentCount}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatLaunchDate(run.completedAt)}
            </TableCell>
            <TableCell>
              {projectionSourceRunId === run.id && (
                <Badge variant="secondary">Projection source</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
