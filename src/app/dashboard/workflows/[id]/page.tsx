import { notFound } from "next/navigation";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { countContactsByCreatedWorkflowRun } from "@/lib/db/queries/contacts";
import { countOrgsByCreatedWorkflowRun } from "@/lib/db/queries/orgs";
import {
  RefreshCw,
  Sparkles,
  Search,
  Trash2,
  Megaphone,
  Bot,
  ArrowLeft,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WorkflowRunLive } from "./workflow-run-live";

const TYPE_ICONS: Record<string, typeof RefreshCw> = {
  sync: RefreshCw,
  import: Upload,
  enrich: Sparkles,
  search: Search,
  prune: Trash2,
  sequence: Megaphone,
  agent: Bot,
};

const IMPORT_SUBTYPE_LABELS: Record<string, string> = {
  linkedin_connections: "LinkedIn Connections Import",
};

const SYNC_SUBTYPE_LABELS: Record<string, string> = {
  x_contacts: "X Contact Sync",
  x_tweets: "X Tweet Sync",
  x_mentions: "X Mention Sync",
  x_enrich: "X Profile Enrichment",
  gmail_contacts: "Gmail Contact Sync",
  gmail_metadata: "Gmail Metadata Enrichment",
  himalaya_correspondents: "Himalaya Correspondent Import",
  himalaya_mail_activity: "Himalaya Mail Activity Enrichment",
  linkedin_contacts: "LinkedIn Contact Sync",
};

function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = getWorkflowRun(id);

  if (!run) notFound();

  const Icon = TYPE_ICONS[run.workflowType] ?? RefreshCw;

  let title = run.workflowType.charAt(0).toUpperCase() + run.workflowType.slice(1) + " Workflow";
  try {
    const config = JSON.parse(run.config ?? "{}");
    if (config.importSubType && run.workflowType === "import") {
      title = IMPORT_SUBTYPE_LABELS[config.importSubType] ?? "File Import";
      if (config.fileName) title += ` — ${config.fileName}`;
    } else if (config.syncSubType && SYNC_SUBTYPE_LABELS[config.syncSubType]) {
      title = SYNC_SUBTYPE_LABELS[config.syncSubType];
    } else if (config.templateName) {
      title = config.templateName;
    }
  } catch { /* ignore */ }

  // Fallback: look up template name for older runs that don't have it in config
  if (title.endsWith(" Workflow") && run.templateId) {
    try {
      const { getTemplate } = await import("@/lib/db/queries/workflow-templates");
      const tmpl = getTemplate(run.templateId);
      if (tmpl?.name) title = tmpl.name;
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6 overflow-hidden">
      {/* Static header — never changes */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/workflows">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-heading-1">{title}</h1>
            <p className="text-xs text-muted-foreground">
              {formatTimestamp(run.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* All dynamic content handled by client component */}
      <WorkflowRunLive
        initialRun={run}
        contactsCreated={countContactsByCreatedWorkflowRun(id)}
        orgsCreated={countOrgsByCreatedWorkflowRun(id)}
      />
    </div>
  );
}
