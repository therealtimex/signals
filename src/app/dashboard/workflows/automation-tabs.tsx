"use client";

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
}

function AutomationTabsInner({ runs, totalRuns }: AutomationTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveTab(searchParams.get("tab"));

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
                Agent orchestration runs in RealTimeX terminal agents and Agent Flows via{" "}
                <code className="text-xs">/api/agent-tools</code>. Runs started here are
                recorded for observability; use RTX to execute migrated workflows (
                <code className="text-xs">docs/rtx-agent-orchestration.md</code>).
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
                title="No runs yet"
                description="Runs are created when you run agents, sync platforms, or import files."
              />
            </Card>
          ) : (
            <WorkflowViewSwitcher runs={runs} />
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
