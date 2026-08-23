"use client";

import * as React from "react";
import {
  Target,
  UserPlus,
  Repeat2,
  HeartHandshake,
  MessageSquare,
  Handshake,
  ChevronDown,
  Check,
  X,
  CircleDot,
  CheckCircle2,
  PauseCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_STATUS_ENUM,
  RELATIONSHIP_GOAL_LABELS,
  RELATIONSHIP_GOAL_STATUS_LABELS,
  type RelationshipGoal,
  type RelationshipGoalStatus,
} from "@/lib/relationship-goals";

const goalIcons: Record<RelationshipGoal, React.ComponentType<{ className?: string }>> = {
  follow_back: UserPlus,
  repost_amplification: Repeat2,
  mutual_engagement: HeartHandshake,
  warm_conversation: MessageSquare,
  partnership: Handshake,
};

const goalColors: Record<RelationshipGoal, string> = {
  follow_back: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  repost_amplification: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  mutual_engagement: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  warm_conversation: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  partnership: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
};

const statusIcons: Record<RelationshipGoalStatus, React.ComponentType<{ className?: string }>> = {
  not_started: CircleDot,
  in_progress: Target,
  achieved: CheckCircle2,
  paused: PauseCircle,
};

const statusColors: Record<RelationshipGoalStatus, string> = {
  not_started: "text-muted-foreground",
  in_progress: "text-amber-500",
  achieved: "text-emerald-500",
  paused: "text-muted-foreground/60",
};

export function RelationshipGoalBadge({
  goal,
  status = "not_started",
  className,
}: {
  goal: RelationshipGoal | string | null | undefined;
  status?: RelationshipGoalStatus | string | null | undefined;
  className?: string;
}) {
  if (!goal || !(goal in RELATIONSHIP_GOAL_LABELS)) {
    return null;
  }

  const typedGoal = goal as RelationshipGoal;
  const typedStatus = (status && status in RELATIONSHIP_GOAL_STATUS_LABELS
    ? status
    : "not_started") as RelationshipGoalStatus;

  const Icon = goalIcons[typedGoal] ?? Target;
  const StatusIcon = statusIcons[typedStatus] ?? CircleDot;

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium px-2 py-0.5",
        goalColors[typedGoal],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{RELATIONSHIP_GOAL_LABELS[typedGoal]}</span>
      <span className="flex items-center text-xs opacity-80" title={RELATIONSHIP_GOAL_STATUS_LABELS[typedStatus]}>
        • <StatusIcon className={cn("ml-1 h-3 w-3 inline", statusColors[typedStatus])} />
      </span>
    </Badge>
  );
}

export function RelationshipGoalSelector({
  goal,
  status = "not_started",
  onSelect,
  disabled = false,
  className,
}: {
  goal: RelationshipGoal | string | null | undefined;
  status?: RelationshipGoalStatus | string | null | undefined;
  onSelect: (goal: RelationshipGoal | null, status: RelationshipGoalStatus) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const typedGoal = goal && goal in RELATIONSHIP_GOAL_LABELS ? (goal as RelationshipGoal) : null;
  const typedStatus = (status && status in RELATIONSHIP_GOAL_STATUS_LABELS
    ? status
    : "not_started") as RelationshipGoalStatus;

  const GoalIcon = typedGoal ? goalIcons[typedGoal] ?? Target : Target;
  const StatusIcon = statusIcons[typedStatus] ?? CircleDot;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 px-2.5 text-xs font-medium rounded-full border transition-colors",
            typedGoal
              ? goalColors[typedGoal]
              : "border-dashed text-muted-foreground hover:text-foreground",
            className
          )}
        >
          <GoalIcon className="mr-1.5 h-3.5 w-3.5" />
          {typedGoal ? (
            <span className="flex items-center gap-1.5">
              <span>{RELATIONSHIP_GOAL_LABELS[typedGoal]}</span>
              <span className="text-[10px] opacity-75 font-normal flex items-center gap-0.5">
                (<StatusIcon className={cn("h-2.5 w-2.5", statusColors[typedStatus])} />
                {RELATIONSHIP_GOAL_STATUS_LABELS[typedStatus]})
              </span>
            </span>
          ) : (
            <span>+ Set Goal</span>
          )}
          <ChevronDown className="ml-1.5 h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Target Relationship Goal
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {RELATIONSHIP_GOAL_ENUM.map((g) => {
            const Icon = goalIcons[g];
            const isSelected = typedGoal === g;
            return (
              <DropdownMenuItem
                key={g}
                className="flex items-center justify-between text-xs cursor-pointer"
                onClick={() => {
                  onSelect(g, isSelected ? typedStatus : "in_progress");
                }}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{RELATIONSHIP_GOAL_LABELS[g]}</span>
                </span>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        {typedGoal && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Goal Progress
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {RELATIONSHIP_GOAL_STATUS_ENUM.map((s) => {
                const SIcon = statusIcons[s];
                const isSelected = typedStatus === s;
                return (
                  <DropdownMenuItem
                    key={s}
                    className="flex items-center justify-between text-xs cursor-pointer"
                    onClick={() => {
                      onSelect(typedGoal, s);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <SIcon className={cn("h-3.5 w-3.5", statusColors[s])} />
                      <span>{RELATIONSHIP_GOAL_STATUS_LABELS[s]}</span>
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-destructive flex items-center gap-2 cursor-pointer focus:text-destructive"
              onClick={() => {
                onSelect(null, "not_started");
              }}
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear Goal</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
