"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import Link from "next/link";
import { Target, Plus, TrendingUp, Users, FileText, ArrowUpRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { GoalDialog } from "./goal-dialog";
import type { Goal } from "@/lib/db/types";

const statusFilters = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "achieved", label: "Achieved" },
  { value: "paused", label: "Paused" },
  { value: "missed", label: "Missed" },
];

const GOAL_TYPE_LABELS: Record<string, string> = {
  audience_growth: "Audience Growth",
  lead_generation: "Lead Generation",
  content_engagement: "Content Engagement",
  pipeline_progression: "Pipeline Progression",
};

const GOAL_TYPE_ICONS: Record<string, typeof TrendingUp> = {
  audience_growth: TrendingUp,
  lead_generation: Users,
  content_engagement: FileText,
  pipeline_progression: ArrowUpRight,
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  achieved: "secondary",
  paused: "outline",
  missed: "destructive",
};

interface GoalsListClientProps {
  goals: Goal[];
  total: number;
  page: number;
  currentStatus?: string;
  currentGoalType?: string;
}

function GoalsListInner({
  goals,
  total,
  currentStatus,
}: GoalsListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete("page");
    router.push(`/dashboard/goals?${params.toString()}`);
  }

  function formatDeadline(deadline: number | null): string | null {
    if (!deadline) return null;
    const now = Math.floor(Date.now() / 1000);
    const daysLeft = Math.ceil((deadline - now) / 86400);
    if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
    if (daysLeft === 0) return "Due today";
    if (daysLeft === 1) return "1 day left";
    return `${daysLeft} days left`;
  }

  if (goals.length === 0 && !currentStatus) {
    return (
      <>
        <EmptyState
          icon={Target}
          mood="attentive"
          title="No goals yet"
          description="Create your first demand generation goal to start tracking progress across your workflows."
        />
        <div className="flex justify-center">
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Goal
          </Button>
        </div>
        <GoalDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => router.refresh()}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <Tabs
          value={currentStatus ?? "all"}
          onValueChange={(v) => setFilter("status", v)}
        >
          <TabsList>
            {statusFilters.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No goals match the current filters.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} goal{total !== 1 ? "s" : ""}
          </p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {goals.map((goal) => {
              const Icon = GOAL_TYPE_ICONS[goal.goalType] ?? Target;
              const pct = goal.targetValue > 0
                ? Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100))
                : 0;
              const deadlineLabel = formatDeadline(goal.deadline);

              return (
                <Link key={goal.id} href={`/dashboard/goals/${goal.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <CardTitle className="text-sm font-medium leading-tight">
                            {goal.name}
                          </CardTitle>
                        </div>
                        <Badge variant={STATUS_VARIANTS[goal.status] ?? "outline"}>
                          {goal.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-muted-foreground">
                            {goal.currentValue.toLocaleString()} / {goal.targetValue.toLocaleString()} {goal.unit}
                          </span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {GOAL_TYPE_LABELS[goal.goalType] ?? goal.goalType}
                        </Badge>
                        {deadlineLabel && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {deadlineLabel}
                          </span>
                        )}
                      </div>
                      {goal.platform && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {goal.platform}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <GoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}

export function GoalsListClient(props: GoalsListClientProps) {
  return (
    <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-lg" />}>
      <GoalsListInner {...props} />
    </Suspense>
  );
}
