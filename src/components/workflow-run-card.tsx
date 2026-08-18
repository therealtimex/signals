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

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted-foreground",
  running: "bg-blue-500",
  paused: "bg-yellow-500",
  completed: "bg-green-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
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

const IMPORT_SUBTYPE_LABELS: Record<string, string> = {
  linkedin_connections: "LinkedIn Import",
};

/** Display label for file-import runs (platform + file name when available). */
function parseImportLabel(run: WorkflowRun): string | null {
  if (run.workflowType !== "import") return null;
  try {
    const config = JSON.parse(run.config ?? "{}");
    const base = IMPORT_SUBTYPE_LABELS[config.importSubType] ?? "File Import";
    return config.fileName ? `${base} — ${config.fileName}` : base;
  } catch {
    return "File Import";
  }
}

function formatRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return "-";
  const end = completedAt ?? Math.floor(Date.now() / 1000);
  const seconds = end - startedAt;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function WorkflowRunCard({
  run,
  variant = "kanban",
}: {
  run: WorkflowRun;
  variant?: "kanban" | "swimlane";
}) {
  const Icon = TYPE_ICONS[run.workflowType] ?? RefreshCw;
  const subType = parseSyncSubType(run);
  const templateName = parseTemplateName(run);
  const importLabel = parseImportLabel(run);
  const label = importLabel ?? (subType ? (SYNC_SUBTYPE_LABELS[subType] ?? subType) : (templateName ?? TYPE_LABELS[run.workflowType] ?? run.workflowType));
  const statusColor = STATUS_COLORS[run.status] ?? STATUS_COLORS.pending;
  const progressPercent =
    run.totalItems && run.totalItems > 0
      ? Math.round((run.processedItems / run.totalItems) * 100)
      : null;

  if (variant === "swimlane") {
    return (
      <Link href={`/dashboard/workflows/${run.id}`} className="block shrink-0">
        <Card className="p-3 w-[220px] hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`h-2 w-2 rounded-full shrink-0 ${statusColor}`} />
            <span className="text-xs font-medium truncate">{label}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{run.successItems > 0 ? `${run.successItems} ok` : run.status}</span>
            <span>{formatRelativeTime(run.createdAt)}</span>
          </div>
        </Card>
      </Link>
    );
  }

  // kanban variant (default)
  return (
    <Link href={`/dashboard/workflows/${run.id}`} className="block">
      <Card className="p-3 hover:bg-muted/50 transition-colors cursor-pointer space-y-2">
        <div className="flex items-center gap-2">
          <div className="rounded bg-muted p-1.5 shrink-0">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <span className="text-xs font-medium truncate flex-1">{label}</span>
          {run.status === "running" && (
            <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
          )}
        </div>

        {run.status === "running" && progressPercent !== null && (
          <Progress value={progressPercent} className="h-1" />
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2">
            {run.successItems > 0 && (
              <span className="flex items-center gap-0.5">
                <CheckCircle className="h-2.5 w-2.5 text-green-500" />
                {run.successItems}
              </span>
            )}
            {run.errorItems > 0 && (
              <span className="flex items-center gap-0.5">
                <XCircle className="h-2.5 w-2.5 text-destructive" />
                {run.errorItems}
              </span>
            )}
          </div>
          <span>{formatDuration(run.startedAt, run.completedAt)}</span>
        </div>
      </Card>
    </Link>
  );
}
