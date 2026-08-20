"use client";

import { Badge } from "@/components/ui/badge";
import { StepOutputRenderer } from "@/components/step-output-renderer";
import {
  Globe,
  Monitor,
  Search,
  Brain,
  Users,
  UserPlus,
  Archive,
  GitBranch,
  RefreshCw,
  AlertCircle,
  Lightbulb,
  Wrench,
  MessageSquare,
  Compass,
  Heart,
  FilePlus,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  SkipForward,
} from "lucide-react";
import type { WorkflowStep } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";
import { formatWorkflowError } from "@/lib/workflows/format-error";
import { formatStepOffsetFromRunStart } from "@/lib/workflows/workflow-step-timing";

const STEP_TYPE_CONFIG: Record<
  string,
  { label: string; icon: typeof Globe; color: string }
> = {
  url_fetch: { label: "URL Fetch", icon: Globe, color: "text-blue-500" },
  browser_scrape: { label: "Browser Scrape", icon: Monitor, color: "text-purple-500" },
  web_search: { label: "Web Search", icon: Search, color: "text-green-500" },
  llm_extract: { label: "LLM Extract", icon: Brain, color: "text-amber-500" },
  contact_merge: { label: "Contact Merge", icon: Users, color: "text-cyan-500" },
  contact_create: { label: "Contact Create", icon: UserPlus, color: "text-emerald-500" },
  contact_archive: { label: "Contact Archive", icon: Archive, color: "text-orange-500" },
  routing_decision: { label: "Routing Decision", icon: GitBranch, color: "text-indigo-500" },
  sync_page: { label: "Sync", icon: RefreshCw, color: "text-sky-500" },
  error: { label: "Error", icon: AlertCircle, color: "text-destructive" },
  // Agent step types
  thinking: { label: "Thinking", icon: Lightbulb, color: "text-yellow-500" },
  tool_call: { label: "Tool Call", icon: Wrench, color: "text-violet-500" },
  tool_result: { label: "Tool Result", icon: MessageSquare, color: "text-teal-500" },
  decision: { label: "Decision", icon: Compass, color: "text-rose-500" },
  engagement_action: { label: "Engagement", icon: Heart, color: "text-pink-500" },
  // Phase 6 content step types
  content_create: { label: "Content Create", icon: FilePlus, color: "text-teal-500" },
  content_publish: { label: "Content Publish", icon: Send, color: "text-blue-500" },
  post_engagement: { label: "Post Engagement", icon: Heart, color: "text-pink-500" },
};

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  skipped: SkipForward,
};

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function parseJson(str: string | null): Record<string, unknown> | null {
  if (!str) return null;
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export function WorkflowStepTimeline({
  steps,
  animate,
  subjectById = {},
  runStartedAt = null,
}: {
  steps: WorkflowStep[];
  animate?: boolean;
  subjectById?: Record<string, WorkflowRunSubject>;
  runStartedAt?: number | null;
}) {
  if (steps.length === 0) {
    return animate ? (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Waiting for agent...
      </div>
    ) : (
      <p className="text-sm text-muted-foreground py-4">
        No steps recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {steps.map((step) => {
        const config = STEP_TYPE_CONFIG[step.stepType] ?? STEP_TYPE_CONFIG.error;
        const StepIcon = config.icon;
        const StatusIcon = STATUS_ICONS[step.status] ?? Clock;
        const output = parseJson(step.output);
        const offsetLabel = formatStepOffsetFromRunStart(step.createdAt, runStartedAt);

        return (
          <div
            key={step.id}
            className={`flex items-start gap-3 py-2 px-3 rounded-md hover:bg-muted/50 text-sm${animate ? " animate-step-slide-in" : ""}`}
          >
            {/* Timestamp */}
            <span className="text-xs font-mono text-muted-foreground w-[84px] shrink-0 pt-0.5">
              {offsetLabel && (
                <span className="block text-[10px] text-foreground/70">{offsetLabel}</span>
              )}
              <span>{formatTime(step.createdAt)}</span>
            </span>

            {/* Step type badge */}
            <div className="flex items-center gap-1.5 w-[140px] shrink-0">
              <StepIcon className={`h-3.5 w-3.5 ${config.color}`} />
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {config.label}
              </Badge>
            </div>

            {/* Description / details */}
            <div className="flex-1 min-w-0 space-y-0.5">
              {step.url && (
                <p className="text-xs font-mono truncate text-muted-foreground">
                  {step.url}
                </p>
              )}
              {step.error && (() => {
                const friendly = formatWorkflowError(step.error);
                return (
                  <p className="text-xs text-destructive" title={step.error}>
                    {friendly.title}
                    {friendly.detail && (
                      <span className="text-muted-foreground ml-1">— {friendly.detail}</span>
                    )}
                  </p>
                );
              })()}
              {output && Object.keys(output).length > 0 && !step.error && (
                <StepOutputRenderer
                  output={output}
                  variant="inline"
                  subjectById={subjectById}
                />
              )}
            </div>

            {/* Status + duration */}
            <div className="flex items-center gap-2 shrink-0">
              {step.durationMs !== null && step.durationMs > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {formatDurationMs(step.durationMs)}
                </span>
              )}
              <StatusIcon
                className={`h-3.5 w-3.5 ${
                  step.status === "completed"
                    ? "text-green-500"
                    : step.status === "failed"
                      ? "text-destructive"
                      : step.status === "running"
                        ? "text-blue-500 animate-spin"
                        : "text-muted-foreground"
                }`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
