"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_ICONS,
  RELATIONSHIP_GOAL_LABELS,
  type RelationshipGoal,
  type RelationshipGoalStatus,
} from "@/lib/relationship-goals";
import {
  generateGoalTactic,
  type ContactGoalContext,
  type PersonaGoalContext,
} from "@/lib/personas/goal-tactics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, Check, Target, Lightbulb, ChevronRight, Zap, Loader2 } from "lucide-react";

interface ExploreTargetPlaybookProps {
  contact: ContactGoalContext;
  persona?: PersonaGoalContext | null;
  onGoalChange?: (goal: RelationshipGoal) => void;
  onDispatched?: (status?: RelationshipGoalStatus) => void;
}

export function ExploreTargetPlaybook({
  contact,
  persona,
  onGoalChange,
  onDispatched,
}: ExploreTargetPlaybookProps) {
  const router = useRouter();
  const [selectedGoalOverride, setSelectedGoalOverride] = useState<RelationshipGoal | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchedSuccess, setDispatchedSuccess] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const activeGoal = (selectedGoalOverride ?? contact.relationshipGoal ?? "follow_back") as RelationshipGoal;
  const effectiveStatus = (dispatchedSuccess ? "in_progress" : contact.relationshipGoalStatus) || "not_started";
  const tactic = generateGoalTactic(contact, persona, activeGoal);

  if (!tactic) return null;

  async function handleCopyPrompt() {
    if (!tactic) return;
    try {
      await navigator.clipboard.writeText(tactic.agentPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // Fallback
    }
  }

  async function handleCopyDraft() {
    if (!tactic) return;
    try {
      await navigator.clipboard.writeText(tactic.suggestedDraft);
      setCopiedDraft(true);
      setTimeout(() => setCopiedDraft(false), 2000);
    } catch {
      // Fallback
    }
  }

  function handleSelectGoal(goal: RelationshipGoal) {
    setSelectedGoalOverride(goal);
    setDispatchedSuccess(false);
    if (onGoalChange) {
      onGoalChange(goal);
    }
  }

  async function handleDispatchAgentTask() {
    if (!tactic || !contact.id) return;
    setIsDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/dispatch-goal-tactic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: activeGoal }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to dispatch agent task");
      }
      setDispatchedSuccess(true);
      if (onDispatched) {
        onDispatched("in_progress");
      }
      try {
        router.refresh();
      } catch {
        // Safe router refresh
      }
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Failed to dispatch task");
      setTimeout(() => setDispatchError(null), 5000);
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/[0.02] shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Target className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Target Playbook</CardTitle>
              {effectiveStatus === "achieved" && (
                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] font-semibold gap-1 py-0 h-4">
                  <Check className="h-2.5 w-2.5" /> Achieved
                </Badge>
              )}
              {effectiveStatus === "in_progress" && (
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] font-medium gap-1 py-0 h-4">
                  <span className="h-1 w-1 rounded-full bg-amber-500 animate-pulse" /> In Progress
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Persona-driven relationship tactics</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-medium">
              <span>{RELATIONSHIP_GOAL_ICONS[activeGoal]}</span>
              <span>{RELATIONSHIP_GOAL_LABELS[activeGoal]}</span>
              <ChevronRight className="h-3 w-3 opacity-50 rotate-90" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {RELATIONSHIP_GOAL_ENUM.map((goal) => (
              <DropdownMenuItem
                key={goal}
                onClick={() => handleSelectGoal(goal)}
                className="flex items-center gap-2 cursor-pointer text-xs"
              >
                <span>{RELATIONSHIP_GOAL_ICONS[goal]}</span>
                <span className={activeGoal === goal ? "font-semibold text-primary" : ""}>
                  {RELATIONSHIP_GOAL_LABELS[goal]}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Strategy section */}
        <div className="rounded-lg bg-background p-3.5 border space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            <span>{tactic.headline}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {tactic.strategy}
          </p>
        </div>

        {/* Action Steps */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Recommended Action Steps
          </p>
          <div className="space-y-1.5">
            {tactic.recommendedActions.map((action, idx) => (
              <div
                key={action}
                className="flex items-start gap-2.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground"
              >
                <Badge
                  variant="secondary"
                  className="h-4 w-4 shrink-0 rounded-full p-0 flex items-center justify-center text-[10px] font-bold"
                >
                  {idx + 1}
                </Badge>
                <span className="leading-snug">{action}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Suggested Draft */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Suggested Angle / Copy
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyDraft}
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
            >
              {copiedDraft ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy draft</span>
                </>
              )}
            </Button>
          </div>
          <div className="rounded-md border bg-muted/30 p-2.5 text-xs italic text-foreground/90">
            &ldquo;{tactic.suggestedDraft}&rdquo;
          </div>
        </div>

        {/* Agent Task Dispatch & Prompt Copy */}
        <div className="pt-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleDispatchAgentTask}
              disabled={isDispatching}
              className={`flex-1 gap-2 text-xs font-medium ${
                effectiveStatus === "achieved"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : effectiveStatus === "in_progress"
                  ? "bg-primary/90 hover:bg-primary text-primary-foreground"
                  : ""
              }`}
            >
              {isDispatching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Dispatching to Nurture Agent...</span>
                </>
              ) : effectiveStatus === "achieved" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-white" />
                  <span>Goal Achieved · Re-run Sequence</span>
                </>
              ) : effectiveStatus === "in_progress" ? (
                <>
                  <Zap className="h-3.5 w-3.5 text-amber-300" />
                  <span>In Progress · Re-dispatch Agent Task</span>
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5 text-amber-300" />
                  <span>Dispatch to Nurture Agent</span>
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyPrompt}
              className="h-9 px-2.5 text-xs gap-1.5 shrink-0"
              title="Copy raw agent instructions to clipboard"
            >
              {copiedPrompt ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="hidden sm:inline">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="hidden sm:inline">Copy Prompt</span>
                </>
              )}
            </Button>
          </div>

          {effectiveStatus === "achieved" && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Relationship Goal Achieved!
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The milestone for this contact was completed. You can select another goal above or review recorded touchpoints in the <strong>Activity</strong> tab.
              </p>
            </div>
          )}

          {effectiveStatus === "in_progress" && (
            <div className="rounded-md border border-primary/20 bg-primary/[0.04] p-2.5 text-[11px] text-foreground space-y-1">
              <p className="font-medium flex items-center gap-1.5 text-primary">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                Active Agent Nurture Task Staged
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Dispatched to the <strong>Contact Relationship Nurture</strong> thread in RealTimeX. Check the <strong>Tasks</strong> tab to monitor task progress.
              </p>
            </div>
          )}

          {dispatchError && (
            <p className="text-[11px] text-destructive">
              ✕ {dispatchError}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
