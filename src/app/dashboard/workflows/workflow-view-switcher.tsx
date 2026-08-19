"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { List, Columns3, Rows3 } from "lucide-react";
import { WorkflowListView } from "@/components/workflow-list-view";
import { WorkflowKanbanView } from "@/components/workflow-kanban-view";
import { WorkflowSwimlaneView } from "@/components/workflow-swimlane-view";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";
import type { WorkflowRun } from "@/lib/db/types";

function ViewSwitcherInner({
  runs,
  subjectsByRunId,
}: {
  runs: WorkflowRun[];
  subjectsByRunId: Record<string, WorkflowRunSubject[]>;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentView = searchParams.get("view") ?? "list";

  function handleViewChange(view: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={currentView} onValueChange={handleViewChange}>
      <TabsList>
        <TabsTrigger value="list" className="gap-1.5">
          <List className="h-3.5 w-3.5" />
          List
        </TabsTrigger>
        <TabsTrigger value="kanban" className="gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          Kanban
        </TabsTrigger>
        <TabsTrigger value="swimlane" className="gap-1.5">
          <Rows3 className="h-3.5 w-3.5" />
          Swimlane
        </TabsTrigger>
      </TabsList>

      <TabsContent value="list" className="mt-4">
        <WorkflowListView runs={runs} subjectsByRunId={subjectsByRunId} />
      </TabsContent>

      <TabsContent value="kanban" className="mt-4">
        <WorkflowKanbanView runs={runs} subjectsByRunId={subjectsByRunId} />
      </TabsContent>

      <TabsContent value="swimlane" className="mt-4">
        <WorkflowSwimlaneView runs={runs} subjectsByRunId={subjectsByRunId} />
      </TabsContent>
    </Tabs>
  );
}

export function WorkflowViewSwitcher({
  runs,
  subjectsByRunId,
}: {
  runs: WorkflowRun[];
  subjectsByRunId: Record<string, WorkflowRunSubject[]>;
}) {
  return (
    <Suspense fallback={<WorkflowListView runs={runs} subjectsByRunId={subjectsByRunId} />}>
      <ViewSwitcherInner runs={runs} subjectsByRunId={subjectsByRunId} />
    </Suspense>
  );
}
