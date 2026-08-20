"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Sparkles,
  Search,
  Trash2,
  Megaphone,
  Bot,
  Upload,
} from "lucide-react";
import { WorkflowRunCard } from "@/components/workflow-run-card";
import type { WorkflowRun } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

/** All possible lanes — ordered by display priority. */
const LANES = [
  { key: "sync", label: "Sync", icon: RefreshCw },
  { key: "import", label: "Import", icon: Upload },
  { key: "search", label: "Search", icon: Search },
  { key: "enrich", label: "Enrich", icon: Sparkles },
  { key: "prune", label: "Prune", icon: Trash2 },
  { key: "content", label: "Content", icon: Bot },
  { key: "engagement", label: "Engage", icon: Bot },
  { key: "outreach", label: "Outreach", icon: Megaphone },
  { key: "agent", label: "Agent", icon: Bot },
] as const;

/** Map templateCategory to lane key. Falls back to workflowType. */
const CATEGORY_TO_LANE: Record<string, string> = {
  prospecting: "search",
  enrichment: "enrich",
  pruning: "prune",
  content: "content",
  engagement: "engagement",
  outreach: "outreach",
  nurture: "agent",
};

function getLaneKey(run: WorkflowRun): string {
  try {
    const config = JSON.parse(run.config ?? "{}");
    if (config.templateCategory) {
      return CATEGORY_TO_LANE[config.templateCategory] ?? run.workflowType;
    }
  } catch { /* fall through */ }
  return run.workflowType;
}

export function WorkflowSwimlaneView({
  runs,
  subjectsByRunId = {},
}: {
  runs: WorkflowRun[];
  subjectsByRunId?: Record<string, WorkflowRunSubject[]>;
}) {
  const grouped: Record<string, WorkflowRun[]> = {};
  for (const lane of LANES) {
    grouped[lane.key] = [];
  }
  for (const run of runs) {
    const laneKey = getLaneKey(run);
    if (grouped[laneKey]) {
      grouped[laneKey].push(run);
    }
  }

  // Filter to lanes that have runs (or show all if none have runs)
  const hasAnyRuns = runs.length > 0;
  const visibleLanes = hasAnyRuns
    ? LANES.filter((lane) => grouped[lane.key].length > 0)
    : LANES;

  if (visibleLanes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No workflow runs found.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {visibleLanes.map((lane) => {
        const items = grouped[lane.key];
        const LaneIcon = lane.icon;

        return (
          <div key={lane.key} className="space-y-2">
            {/* Lane header */}
            <div className="flex items-center gap-2 px-1">
              <LaneIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{lane.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {items.length}
              </Badge>
            </div>

            {/* Lane body — horizontal scroll */}
            {items.length === 0 ? (
              <p className="text-[10px] text-muted-foreground px-1 py-4">
                No runs
              </p>
            ) : (
              <ScrollArea className="w-full">
                <div className="flex gap-2 pb-2">
                  {items.map((run) => (
                    <WorkflowRunCard
                      key={run.id}
                      run={run}
                      variant="swimlane"
                      subjects={subjectsByRunId[run.id] ?? []}
                    />
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
          </div>
        );
      })}
    </div>
  );
}
