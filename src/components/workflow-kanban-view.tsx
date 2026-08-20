"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowRunCard } from "@/components/workflow-run-card";
import type { WorkflowRun } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

const COLUMNS = [
  { key: "pending", label: "Pending", color: "bg-muted-foreground" },
  { key: "running", label: "Running", color: "bg-blue-500" },
  { key: "completed", label: "Completed", color: "bg-green-500" },
  { key: "failed", label: "Failed", color: "bg-destructive" },
] as const;

export function WorkflowKanbanView({
  runs,
  subjectsByRunId = {},
}: {
  runs: WorkflowRun[];
  subjectsByRunId?: Record<string, WorkflowRunSubject[]>;
}) {
  const grouped: Record<string, WorkflowRun[]> = {
    pending: [],
    running: [],
    completed: [],
    failed: [],
  };

  for (const run of runs) {
    if (run.status === "paused") {
      grouped.pending.push(run);
    } else if (run.status === "cancelled") {
      grouped.failed.push(run);
    } else if (grouped[run.status]) {
      grouped[run.status].push(run);
    } else {
      grouped.pending.push(run);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {COLUMNS.map((col) => {
        const items = grouped[col.key];
        return (
          <div key={col.key} className="space-y-2">
            {/* Column header */}
            <div className="flex items-center gap-2 px-1">
              <span className={`h-2 w-2 rounded-full ${col.color}`} />
              <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">
                {items.length}
              </Badge>
            </div>

            {/* Column body */}
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-2 pr-2">
                {items.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-8">
                    No runs
                  </p>
                ) : (
                  items.map((run) => (
                    <WorkflowRunCard
                      key={run.id}
                      run={run}
                      variant="kanban"
                      subjects={subjectsByRunId[run.id] ?? []}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}
