"use client";

import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Sparkles,
  Search,
  Trash2,
  Megaphone,
  Bot,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Pause,
  Ban,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type { WorkflowRun } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";
import { WorkflowRunSubjectLinks } from "@/components/workflow-run-subject-links";

const TYPE_ICONS: Record<string, typeof RefreshCw> = {
  sync: RefreshCw,
  import: Upload,
  enrich: Sparkles,
  search: Search,
  prune: Trash2,
  sequence: Megaphone,
  agent: Bot,
};

const TYPE_LABELS: Record<string, string> = {
  sync: "Sync",
  import: "Import",
  enrich: "Enrich",
  search: "Search",
  prune: "Prune",
  sequence: "Sequence",
  agent: "Agent",
};

/** Human-friendly labels for template categories (from templateType). */
const CATEGORY_LABELS: Record<string, string> = {
  prospecting: "Search",
  enrichment: "Enrich",
  pruning: "Prune",
  content: "Content",
  engagement: "Engage",
  outreach: "Outreach",
  nurture: "Nurture",
};

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

const SYNC_SUBTYPE_LABELS: Record<string, string> = {
  x_contacts: "X Contacts",
  x_tweets: "X Tweets",
  x_mentions: "X Mentions",
  x_enrich: "X Profiles",
  gmail_contacts: "Gmail Contacts",
  gmail_metadata: "Gmail Metadata",
  himalaya_correspondents: "Himalaya Correspondents",
  himalaya_mail_activity: "Himalaya Mail Activity",
  linkedin_contacts: "LinkedIn",
};

const IMPORT_SUBTYPE_LABELS: Record<string, string> = {
  linkedin_connections: "LinkedIn Import",
  x_archive: "X Archive Import",
  x_archive_contacts: "X Archive Contacts",
  x_archive_posts: "X Archive Posts",
};

/** Display info for file-import runs (platform label + file name when available). */
function parseImportInfo(run: WorkflowRun): { label: string; fileName: string | null } | null {
  if (run.workflowType !== "import") return null;
  try {
    const config = JSON.parse(run.config ?? "{}");
    return {
      label: IMPORT_SUBTYPE_LABELS[config.importSubType] ?? "File Import",
      fileName: config.fileName ?? null,
    };
  } catch {
    return { label: "File Import", fileName: null };
  }
}

function parseSyncSubType(run: WorkflowRun): string | null {
  try {
    const config = JSON.parse(run.config ?? "{}");
    return config.syncSubType ?? null;
  } catch {
    return null;
  }
}

function parseTemplateName(run: WorkflowRun): string | null {
  try {
    const config = JSON.parse(run.config ?? "{}");
    return config.templateName ?? null;
  } catch {
    return null;
  }
}

function parseTemplateCategory(run: WorkflowRun): string | null {
  try {
    const config = JSON.parse(run.config ?? "{}");
    return config.templateCategory ?? null;
  } catch {
    return null;
  }
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return "-";
  const end = completedAt ?? Math.floor(Date.now() / 1000);
  const seconds = end - startedAt;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parsePipelineBatch(run: WorkflowRun): {
  batchSize: number;
  backlogTotal: number;
} | null {
  try {
    const config = JSON.parse(run.config ?? "{}");
    if (!config.pipeline) return null;
    return {
      batchSize: config.batchSize ?? 0,
      backlogTotal: config.backlogTotal ?? 0,
    };
  } catch {
    return null;
  }
}

function formatMetricValue(
  value: number,
  run: WorkflowRun,
  tone: "success" | "skip" | "error" = "skip",
): ReactNode {
  const hasBatch = (run.totalItems ?? 0) > 0;
  const showZero =
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled" ||
    (hasBatch && run.status === "running");

  if (value > 0) {
    if (tone === "success") {
      return <span className="text-green-600">{value}</span>;
    }
    if (tone === "error") {
      return <span className="text-destructive">{value}</span>;
    }
    return value;
  }

  if (showZero) {
    return <span className="text-muted-foreground">0</span>;
  }

  return <span className="text-muted-foreground">-</span>;
}

function formatRunProgressSubtitle(run: WorkflowRun): string | null {
  const totalItems = run.totalItems ?? 0;
  const pipeline = parsePipelineBatch(run);
  if (pipeline && run.status === "running") {
    if (totalItems > 0) {
      const processed = Math.min(run.processedItems, totalItems);
      return `Processing ${processed}/${totalItems} contacts · ${pipeline.backlogTotal} in backlog`;
    }
    return `Batch ${pipeline.batchSize} · ${pipeline.backlogTotal} in backlog`;
  }

  if (run.status === "running" && totalItems > 0) {
    const processed = Math.min(run.processedItems, totalItems);
    return `${processed}/${totalItems} processed`;
  }

  return null;
}

export function WorkflowListView({
  runs,
  subjectsByRunId = {},
}: {
  runs: WorkflowRun[];
  subjectsByRunId?: Record<string, WorkflowRunSubject[]>;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No workflow runs found.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]" />
            <TableHead>Workflow</TableHead>
            <TableHead className="w-[190px] text-right">Subject</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[80px] text-right">Success</TableHead>
            <TableHead className="w-[70px] text-right">Skip</TableHead>
            <TableHead className="w-[70px] text-right">Error</TableHead>
            <TableHead className="w-[80px] text-right">Duration</TableHead>
            <TableHead className="w-[90px] text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const Icon = TYPE_ICONS[run.workflowType] ?? RefreshCw;
            const subType = parseSyncSubType(run);
            const subLabel = subType ? (SYNC_SUBTYPE_LABELS[subType] ?? null) : null;
            const templateName = parseTemplateName(run);
            const templateCategory = parseTemplateCategory(run);
            const importInfo = parseImportInfo(run);
            const pipelineBatch = parsePipelineBatch(run);
            const progressSubtitle = formatRunProgressSubtitle(run);
            const displayName = importInfo?.label ?? subLabel ?? templateName ?? (TYPE_LABELS[run.workflowType] ?? run.workflowType);
            // Use templateCategory for the type badge (e.g. "Content" instead of "Agent")
            const typeLabel = (templateCategory ? CATEGORY_LABELS[templateCategory] : null)
              ?? TYPE_LABELS[run.workflowType] ?? run.workflowType;
            const statusConfig = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = statusConfig.icon;
            const subjects = subjectsByRunId[run.id] ?? [];
            const workflowRunHref = `/dashboard/workflows/${run.id}`;

            return (
              <TableRow key={run.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    <div className="rounded bg-muted p-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    <span className="text-sm font-medium">
                      {displayName}
                    </span>
                    <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] font-normal align-middle">
                      {typeLabel}
                    </Badge>
                    {importInfo?.fileName && (
                      <span className="text-xs text-muted-foreground ml-2 break-all">
                        {importInfo.fileName}
                      </span>
                    )}
                    {progressSubtitle && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {progressSubtitle}
                      </p>
                    )}
                    {!progressSubtitle && pipelineBatch && run.status !== "running" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Batch {pipelineBatch.batchSize} · {pipelineBatch.backlogTotal} in backlog
                      </p>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="text-right align-top">
                  <WorkflowRunSubjectLinks
                    subjects={subjects}
                    workflowRunHref={workflowRunHref}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    <Badge variant={statusConfig.variant} className="text-[10px] px-1.5 py-0">
                      {run.status === "running" ? (
                        <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <StatusIcon className="mr-1 h-2.5 w-2.5" />
                      )}
                      {statusConfig.label}
                    </Badge>
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {formatMetricValue(run.successItems, run, "success")}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {formatMetricValue(run.skippedItems, run, "skip")}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {formatMetricValue(run.errorItems, run, "error")}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </Link>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {formatRelativeTime(run.createdAt)}
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
