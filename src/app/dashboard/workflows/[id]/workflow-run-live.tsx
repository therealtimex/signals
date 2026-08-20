"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Pause,
  Ban,
  Cpu,
  Coins,
  Bot,
} from "lucide-react";
import Link from "next/link";
import { formatWorkflowError } from "@/lib/workflows/format-error";
import { WorkflowDetailSteps } from "./workflow-detail-steps";
import { PruneResults } from "./prune-results";
import { WorkflowRunSubjectsPanel } from "@/components/workflow-run-subjects-panel";
import { useWorkflowPolling } from "@/hooks/use-workflow-polling";
import type { WorkflowRunWithSteps } from "@/lib/db/types";
import type { PipelineRunResult } from "@/lib/workflows/pipeline/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";
import { workflowSubjectLookup } from "@/lib/workflows/workflow-run-subjects-shared";

type PipelineRunContext = {
  backlogTotal: number;
  batchSize: number;
  selectedCount: number;
  result: PipelineRunResult | null;
};

type PipelineRunLike = {
  config: string | null;
  result: string | null;
};

function parsePipelineRunContext(run: PipelineRunLike): PipelineRunContext | null {
  try {
    const config = JSON.parse(run.config ?? "{}") as {
      pipeline?: unknown;
      backlogTotal?: number;
      batchSize?: number;
      selectedContactIds?: string[];
    };
    if (!config.pipeline) return null;

    let result: PipelineRunResult | null = null;
    if (run.result) {
      result = JSON.parse(run.result) as PipelineRunResult;
    }

    return {
      backlogTotal: config.backlogTotal ?? 0,
      batchSize: config.batchSize ?? 0,
      selectedCount: config.selectedContactIds?.length ?? config.batchSize ?? 0,
      result,
    };
  } catch {
    return null;
  }
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }
> = {
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  running: { label: "Running", variant: "default", icon: Loader2 },
  paused: { label: "Paused", variant: "outline", icon: Pause },
  completed: { label: "Completed", variant: "secondary", icon: CheckCircle },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "outline", icon: Ban },
};

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return "-";
  const end = completedAt ?? Math.floor(Date.now() / 1000);
  const seconds = end - startedAt;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function StatCard({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total?: number | null;
  color?: string;
}) {
  return (
    <Card className="p-3 text-center">
      <p className="text-2xl font-semibold tabular-nums">
        <span className={color}>{value}</span>
        {total != null && total > 0 && (
          <span className="text-sm text-muted-foreground">/{total}</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

export function WorkflowRunLive({
  initialRun,
  subjects = [],
  contactsCreated = 0,
  orgsCreated = 0,
}: {
  initialRun: WorkflowRunWithSteps;
  subjects?: WorkflowRunSubject[];
  contactsCreated?: number;
  orgsCreated?: number;
}) {
  const { data, isPolling } = useWorkflowPolling(initialRun.id, initialRun.status);

  // Use polled data when available, fall back to server-rendered initial data
  const run = data?.run ?? initialRun;
  const steps = data?.steps ?? initialRun.steps;
  const subjectById = workflowSubjectLookup(subjects);

  const statusConfig = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const isAgent = run.workflowType === "agent";
  const totalTokens = run.inputTokens + run.outputTokens;
  const pipelineCtx = parsePipelineRunContext(run);

  return (
    <>
      {/* Status badge with live indicator */}
      <div className="flex items-center gap-2 -mt-4 justify-end">
        {isPolling && (
          <span className="flex items-center gap-1.5 text-xs text-green-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Live
          </span>
        )}
        <Badge variant={statusConfig.variant} className="text-xs px-2 py-0.5">
          {run.status === "running" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <StatusIcon className="mr-1 h-3 w-3" />
          )}
          {statusConfig.label}
        </Badge>
      </div>

      {pipelineCtx && (
        <Card className="p-4 text-sm">
          {run.status === "running" || !pipelineCtx.result ? (
            <p>
              Processing <strong>{pipelineCtx.selectedCount}</strong> of{" "}
              <strong>{pipelineCtx.backlogTotal}</strong>…
            </p>
          ) : (
            <p>
              Processed <strong>{pipelineCtx.result.processed}</strong> · hydrated{" "}
              <strong>{pipelineCtx.result.profilesHydrated ?? 0}</strong> · avatars{" "}
              <strong>{pipelineCtx.result.avatarsUpdated}</strong> · personas{" "}
              <strong>{pipelineCtx.result.personasGenerated}</strong> ·{" "}
              <strong>{pipelineCtx.result.remainingBacklog}</strong> remaining
            </p>
          )}
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Processed" value={run.processedItems} total={run.totalItems} />
        <StatCard label="Success" value={run.successItems} color="text-green-500" />
        <StatCard label="Skipped" value={run.skippedItems} color="text-muted-foreground" />
        <StatCard label="Errors" value={run.errorItems} color="text-destructive" />
      </div>

      {/* Agent-specific cards */}
      {isAgent && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {run.model && (
            <Card className="p-3 flex items-center gap-3">
              <div className="rounded bg-muted p-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Model</p>
                <p className="text-sm font-medium font-mono truncate">{run.model}</p>
              </div>
            </Card>
          )}
          <Card className="p-3 flex items-center gap-3">
            <div className="rounded bg-muted p-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Tokens</p>
              <p className="text-sm font-medium tabular-nums">
                {totalTokens.toLocaleString()}
                <span className="text-xs text-muted-foreground ml-1">
                  ({run.inputTokens.toLocaleString()} in / {run.outputTokens.toLocaleString()} out)
                </span>
              </p>
            </div>
          </Card>
          {run.costUsd > 0 && (
            <Card className="p-3 flex items-center gap-3">
              <div className="rounded bg-muted p-2">
                <Coins className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="text-sm font-medium tabular-nums">
                  ${run.costUsd.toFixed(4)}
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Duration */}
      <Card className="p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Duration</span>
          <span className="font-mono">
            {formatDuration(run.startedAt, run.completedAt)}
          </span>
        </div>
      </Card>

      {(contactsCreated > 0 || orgsCreated > 0) && (
        <Card className="p-4 space-y-2">
          {contactsCreated > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Contacts created</span>
              <Link
                href={`/dashboard/contacts?createdWorkflowRunId=${run.id}`}
                className="font-medium text-primary hover:underline tabular-nums"
              >
                {contactsCreated}
              </Link>
            </div>
          ) : null}
          {orgsCreated > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Organizations created</span>
              <span className="font-medium tabular-nums">{orgsCreated}</span>
            </div>
          ) : null}
        </Card>
      )}

      {/* Prune results (when applicable) */}
      {run.workflowType === "prune" && !isPolling && run.result && (
        <PruneResults runId={run.id} resultJson={typeof run.result === "string" ? run.result : "{}"} />
      )}

      <WorkflowRunSubjectsPanel subjects={subjects} />

      {/* Step section with Timeline/Graph toggle */}
      <WorkflowDetailSteps
        steps={steps}
        animate={isPolling}
        subjectById={subjectById}
        runStartedAt={run.startedAt}
      />

      {/* Errors (if any) */}
      {run.errorItems > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-destructive">Errors</h2>
          <Card className="p-4 space-y-2">
            {(() => {
              try {
                const errorsJson = typeof run.errors === "string" ? run.errors : "[]";
                const errors: string[] = JSON.parse(errorsJson);
                return errors.map((err, i) => {
                  const friendly = formatWorkflowError(err);
                  return (
                    <div key={i} className="space-y-0.5" title={err}>
                      <p className="text-xs text-destructive font-medium">{friendly.title}</p>
                      {friendly.detail && (
                        <p className="text-xs text-muted-foreground">{friendly.detail}</p>
                      )}
                    </div>
                  );
                });
              } catch {
                return <p className="text-xs text-muted-foreground">Unable to parse errors</p>;
              }
            })()}
          </Card>
        </section>
      )}
    </>
  );
}
