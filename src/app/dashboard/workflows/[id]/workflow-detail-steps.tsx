"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, GitBranch } from "lucide-react";
import { WorkflowStepTimeline } from "@/components/workflow-step-timeline";
import { WorkflowGraphView } from "@/components/workflow-graph-view";
import type { WorkflowStep } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

export function WorkflowDetailSteps({
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
  const [view, setView] = useState<"timeline" | "graph">("timeline");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Steps
          <Badge variant="secondary" className="ml-2 text-[10px]">
            {steps.length}
          </Badge>
        </h2>
        <div className="flex items-center gap-1 rounded-md border border-border/50 p-0.5">
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setView("timeline")}
          >
            <List className="h-3 w-3" />
            Timeline
          </Button>
          <Button
            variant={view === "graph" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setView("graph")}
          >
            <GitBranch className="h-3 w-3" />
            Graph
          </Button>
        </div>
      </div>

      <Card className="p-2">
        {view === "timeline" ? (
          <WorkflowStepTimeline
            steps={steps}
            animate={animate}
            subjectById={subjectById}
            runStartedAt={runStartedAt}
          />
        ) : (
          <WorkflowGraphView steps={steps} animate={animate} />
        )}
      </Card>
    </section>
  );
}
