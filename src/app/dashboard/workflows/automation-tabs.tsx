"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { TemplateGallery } from "./template-gallery";
import { ScheduledJobsList } from "./scheduled-jobs-list";
import { ActionCards } from "./action-cards";
import { WorkflowViewSwitcher } from "./workflow-view-switcher";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Zap, Info } from "lucide-react";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";
import type { WorkflowRun } from "@/lib/db/types";

const TABS = [
  { key: "workflows", label: "Workflows" },
  { key: "runs", label: "Runs" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Map legacy tab params (agents, actions) onto the merged Workflows tab. */
function resolveTab(param: string | null): TabKey {
  if (param === "runs") return "runs";
  return "workflows";
}

interface AutomationTabsProps {
  runs: WorkflowRun[];
  totalRuns: number;
  subjectsByRunId: Record<string, WorkflowRunSubject[]>;
}

function AutomationTabsInner({ runs, totalRuns, subjectsByRunId }: AutomationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveTab(searchParams.get("tab"));
  const hasRunningRuns = runs.some((run) => run.status === "running");

  useEffect(() => {
    if (activeTab !== "runs" || !hasRunningRuns) return;
    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [activeTab, hasRunningRuns, router]);

  function setTab(tab: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "workflows") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    router.push(`/dashboard/workflows?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            variant="ghost"
            size="sm"
            className={`h-9 rounded-none border-b-2 px-4 ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "workflows" && (
        <div className="space-y-8">
          <Card className="border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Most Agent Workflows launch a RealTimeX terminal agent on a workspace thread, where
                the agent executes the template brief using{" "}
                <code className="text-xs">realtimex-signals</code> and{" "}
                <code className="text-xs">POST /api/agent-tools/invoke</code>; recurring schedules
                for those belong in RealTimeX Agent Flows. Deduplicate &amp; Merge Contacts is the
                exception — detection and merging are deterministic, so Run opens a review panel
                and no model is involved.
              </p>
            </div>
          </Card>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Platform Workflows</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sync and import data from connected platforms and file exports.
              </p>
            </div>
            <ActionCards />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Agent Workflows</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Agent templates for search, enrichment, content, and engagement.
              </p>
            </div>
            <TemplateGallery />
          </section>

          <ScheduledJobsList />
        </div>
      )}

      {activeTab === "runs" && (
        <>
          {totalRuns === 0 ? (
            <Card className="border-border/50">
              <EmptyState
                icon={Zap}
                mood="sleepy"
                title="No runs yet"
                description="Runs are created when you run agents, sync platforms, or import files."
              />
            </Card>
          ) : (
            <WorkflowViewSwitcher runs={runs} subjectsByRunId={subjectsByRunId} />
          )}
        </>
      )}
    </div>
  );
}

export function AutomationTabs(props: AutomationTabsProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AutomationTabsInner {...props} />
    </Suspense>
  );
}
