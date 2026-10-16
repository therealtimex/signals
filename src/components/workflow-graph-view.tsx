"use client";

import { useState } from "react";
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
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type { WorkflowStep } from "@/lib/db/types";
import { formatWorkflowError } from "@/lib/workflows/format-error";
import {
  navigationContextFor,
  type RunNavigationDenial,
} from "@/lib/browser/navigation-blocked";

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
  routing_decision: { label: "Routing", icon: GitBranch, color: "text-indigo-500" },
  sync_page: { label: "Sync", icon: RefreshCw, color: "text-sky-500" },
  error: { label: "Error", icon: AlertCircle, color: "text-destructive" },
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

const STATUS_BORDER: Record<string, string> = {
  pending: "border-muted-foreground",
  running: "border-blue-500",
  completed: "border-green-500",
  failed: "border-destructive",
  skipped: "border-muted-foreground",
};

const STATUS_BG: Record<string, string> = {
  pending: "bg-muted",
  running: "bg-blue-500/10",
  completed: "bg-green-500/10",
  failed: "bg-destructive/10",
  skipped: "bg-muted",
};

function formatDurationMs(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function parseJson(str: string | null): Record<string, unknown> | null {
  if (!str) return null;
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function GraphNode({
  step,
  isLast,
  navigationDenials,
}: {
  step: WorkflowStep;
  isLast: boolean;
  navigationDenials?: RunNavigationDenial[];
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STEP_TYPE_CONFIG[step.stepType] ?? STEP_TYPE_CONFIG.error;
  const StepIcon = config.icon;
  const borderColor = STATUS_BORDER[step.status] ?? STATUS_BORDER.pending;
  const bgColor = STATUS_BG[step.status] ?? STATUS_BG.pending;
  const output = parseJson(step.output);
  const input = parseJson(step.input);
  const hasDetails = !!(step.error || output || input || step.url);

  return (
    <div className="flex gap-4">
      {/* Vertical line + circle node */}
      <div className="flex flex-col items-center shrink-0 w-8">
        <div
          className={`h-8 w-8 rounded-full border-2 ${borderColor} ${bgColor} flex items-center justify-center`}
        >
          <StepIcon className={`h-3.5 w-3.5 ${config.color}`} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 min-h-[24px] bg-border" />
        )}
      </div>

      {/* Step card */}
      <div className="flex-1 pb-4 min-w-0">
        <div
          className={`rounded-lg border border-border/50 p-3 ${
            hasDetails ? "cursor-pointer hover:bg-muted/30 transition-colors" : ""
          }`}
          onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
        >
          {/* Header row */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal shrink-0">
              {config.label}
            </Badge>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {step.durationMs !== null && step.durationMs > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {formatDurationMs(step.durationMs)}
                </span>
              )}
              {hasDetails && (
                expanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )
              )}
            </div>
          </div>

          {/* Error (always visible) */}
          {step.error && (() => {
            const friendly = formatWorkflowError(
              step.error,
              navigationContextFor(step.error, navigationDenials),
            );
            return (
              <p className="text-xs text-destructive mt-1 break-words" title={step.error}>
                {friendly.title}
                {friendly.detail && (
                  <span className="text-muted-foreground ml-1">— {friendly.detail}</span>
                )}
              </p>
            );
          })()}

          {/* Expanded details */}
          {expanded && (
            <div className="mt-2 pt-2 border-t border-border/50 space-y-2">
              {step.url && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground">URL</span>
                  <p className="text-xs font-mono truncate">{step.url}</p>
                </div>
              )}
              {input && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground">Input</span>
                  <pre className="text-[10px] font-mono bg-muted rounded p-2 overflow-x-auto max-h-[120px]">
                    {JSON.stringify(input, null, 2)}
                  </pre>
                </div>
              )}
              {output && !step.error && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground">Output</span>
                  <StepOutputRenderer output={output} variant="block" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkflowGraphView({
  steps,
  animate,
  navigationDenials,
}: {
  steps: WorkflowStep[];
  animate?: boolean;
  navigationDenials?: RunNavigationDenial[];
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
    <div className="pl-2">
      {steps.map((step, i) => (
        <div key={step.id} className={animate ? "animate-step-slide-in" : ""}>
          <GraphNode
            step={step}
            isLast={i === steps.length - 1}
            navigationDenials={navigationDenials}
          />
        </div>
      ))}
    </div>
  );
}
