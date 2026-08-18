import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
} from "lucide-react";
import Link from "next/link";
import type { WorkflowRun } from "@/lib/db/types";

const TYPE_ICONS: Record<string, typeof RefreshCw> = {
  sync: RefreshCw,
  enrich: Sparkles,
  search: Search,
  prune: Trash2,
  sequence: Megaphone,
  agent: Bot,
};

const TYPE_LABELS: Record<string, string> = {
  sync: "Platform Sync",
  enrich: "Enrichment",
  search: "Web Search",
  prune: "Pruning",
  sequence: "Sequence",
  agent: "AI Agent",
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

function parseSyncSubType(run: WorkflowRun): string | null {
  try {
    const config = JSON.parse(run.config ?? "{}");
    return config.syncSubType ?? null;
  } catch {
    return null;
  }
}

const SYNC_SUBTYPE_LABELS: Record<string, string> = {
  x_contacts: "X Contacts",
  x_tweets: "X Tweets",
  x_mentions: "X Mentions",
  x_enrich: "X Profiles",
  gmail_contacts: "Gmail Contacts",
  gmail_metadata: "Gmail Metadata",
  himalaya_correspondents: "Himalaya Correspondents",
  himalaya_mail_activity: "Himalaya Mail Activity",
  linkedin_contacts: "LinkedIn Contacts",
};

export function WorkflowProgressCard({ run }: { run: WorkflowRun }) {
  const Icon = TYPE_ICONS[run.workflowType] ?? RefreshCw;
  const typeLabel = TYPE_LABELS[run.workflowType] ?? run.workflowType;
  const statusConfig = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const subType = parseSyncSubType(run);
  const subLabel = subType ? SYNC_SUBTYPE_LABELS[subType] : null;

  const progressPercent =
    run.totalItems && run.totalItems > 0
      ? Math.round((run.processedItems / run.totalItems) * 100)
      : null;

  return (
    <Link href={`/dashboard/workflows/${run.id}`}>
      <Card className="p-4 hover:bg-muted/50 transition-colors cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="rounded-md bg-muted p-2 shrink-0">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {subLabel ?? typeLabel}
                </span>
                <Badge variant={statusConfig.variant} className="text-[10px] px-1.5 py-0 shrink-0">
                  {run.status === "running" ? (
                    <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <StatusIcon className="mr-1 h-2.5 w-2.5" />
                  )}
                  {statusConfig.label}
                </Badge>
              </div>

              {/* Progress bar */}
              {run.status === "running" && (
                <Progress
                  value={progressPercent ?? 100}
                  className="h-1.5"
                />
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {run.processedItems > 0 && (
                  <span>
                    {run.successItems} success
                    {run.skippedItems > 0 && `, ${run.skippedItems} skipped`}
                    {run.errorItems > 0 && `, ${run.errorItems} error${run.errorItems !== 1 ? "s" : ""}`}
                  </span>
                )}
                <span>{formatDuration(run.startedAt, run.completedAt)}</span>
                <span>{formatRelativeTime(run.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
