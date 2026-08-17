"use client";

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
  linkedin_contacts: "LinkedIn",
};

const IMPORT_SUBTYPE_LABELS: Record<string, string> = {
  linkedin_connections: "LinkedIn Import",
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

export function WorkflowListView({ runs }: { runs: WorkflowRun[] }) {
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
            const displayName = importInfo?.label ?? subLabel ?? templateName ?? (TYPE_LABELS[run.workflowType] ?? run.workflowType);
            // Use templateCategory for the type badge (e.g. "Content" instead of "Agent")
            const typeLabel = (templateCategory ? CATEGORY_LABELS[templateCategory] : null)
              ?? TYPE_LABELS[run.workflowType] ?? run.workflowType;
            const statusConfig = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = statusConfig.icon;

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
                  </Link>
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
                    {run.successItems > 0 ? (
                      <span className="text-green-600">{run.successItems}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {run.skippedItems > 0 ? run.skippedItems : <span className="text-muted-foreground">-</span>}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <Link href={`/dashboard/workflows/${run.id}`} className="block">
                    {run.errorItems > 0 ? (
                      <span className="text-destructive">{run.errorItems}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
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
