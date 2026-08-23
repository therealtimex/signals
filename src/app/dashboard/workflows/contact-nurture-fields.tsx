"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actingTargetLabel } from "@/app/dashboard/workflows/activate-dialog.utils";
import { useActingTargets } from "@/app/dashboard/workflows/use-acting-targets";
import { BoundedSlider } from "@/app/dashboard/workflows/workflow-config-fields";
import {
  CONTACT_NURTURE_SLIDERS,
  clampContactNurtureSlider,
  type ContactNurtureConfig,
  type ContactNurtureSliderKey,
} from "@/lib/workflows/contact-relationship-nurture";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_ICONS,
  RELATIONSHIP_GOAL_LABELS,
  type RelationshipGoal,
} from "@/lib/relationship-goals";

interface ContactNurtureFieldsProps {
  value: ContactNurtureConfig;
  onChange: (next: ContactNurtureConfig) => void;
  disabled?: boolean;
}

export function ContactNurtureFields({
  value,
  onChange,
  disabled,
}: ContactNurtureFieldsProps) {
  const targets = useActingTargets();

  const setSlider = useCallback(
    (key: ContactNurtureSliderKey, next: number) => {
      onChange({ ...value, [key]: clampContactNurtureSlider(key, next) });
    },
    [onChange, value],
  );

  return (
    <div className="space-y-4">
      {/* Acting profile selector */}
      <div className="space-y-2">
        <Label htmlFor="nurture-target">Acting profile</Label>
        <Select
          value={value.targetId ?? ""}
          onValueChange={(next) => onChange({ ...value, targetId: next })}
          disabled={disabled || !targets?.length}
        >
          <SelectTrigger id="nurture-target">
            <SelectValue
              placeholder={
                targets === null
                  ? "Loading profiles…"
                  : "Select an acting profile"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(targets ?? []).map((target) => (
              <SelectItem key={target.id} value={target.id}>
                {actingTargetLabel(target)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {targets !== null && targets.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No acting profiles registered.{" "}
            <Link href="/dashboard/settings" className="underline">
              Connect a browser session in Settings
            </Link>{" "}
            first.
          </p>
        )}
      </div>

      {/* Relationship Goal Filter */}
      <div className="space-y-2">
        <Label htmlFor="nurture-goal-filter">Relationship goal scope</Label>
        <Select
          value={value.relationshipGoalFilter}
          onValueChange={(next) =>
            onChange({
              ...value,
              relationshipGoalFilter: next as "all" | RelationshipGoal,
            })
          }
          disabled={disabled}
        >
          <SelectTrigger id="nurture-goal-filter">
            <SelectValue placeholder="All assigned relationship goals" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              🎯 All assigned relationship goals
            </SelectItem>
            {RELATIONSHIP_GOAL_ENUM.map((goal) => (
              <SelectItem key={goal} value={goal}>
                {RELATIONSHIP_GOAL_ICONS[goal]} {RELATIONSHIP_GOAL_LABELS[goal]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Filter targets by their assigned goal or nurture across all active goals.
        </p>
      </div>

      {/* Shift Budget & Pacing */}
      <div className="space-y-3 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Shift budget &amp; pacing
        </p>

        <BoundedSlider
          id="nurture-contacts"
          label="Target contacts to inspect"
          bounds={CONTACT_NURTURE_SLIDERS.maxTargets}
          value={value.maxTargets}
          onChange={(next) => setSlider("maxTargets", next)}
          disabled={disabled}
          format={(v) => (v === 1 ? "1 contact" : `${v} contacts`)}
          hint="Max unachieved contacts to evaluate in this shift."
        />

        <BoundedSlider
          id="nurture-actions"
          label="Max actions budget"
          bounds={CONTACT_NURTURE_SLIDERS.maxActionsPerRun}
          value={value.maxActionsPerRun}
          onChange={(next) => setSlider("maxActionsPerRun", next)}
          disabled={disabled}
          format={(v) => (v === 1 ? "1 action" : `${v} actions`)}
          hint="Maximum comments, spotlights, or DMs to execute in this run."
        />

        <BoundedSlider
          id="nurture-delay"
          label="Safety sleep delay"
          bounds={CONTACT_NURTURE_SLIDERS.delayBetweenActionsSeconds}
          value={value.delayBetweenActionsSeconds}
          onChange={(next) => setSlider("delayBetweenActionsSeconds", next)}
          disabled={disabled}
          format={(v) => `${v}s delay`}
          hint="Salted random variance is applied between consecutive platform actions."
        />
      </div>

      {/* Safety & Automation Toggles */}
      <div className="space-y-3 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="nurture-approval" className="text-sm">
              Require confirmation before publishing
            </Label>
            <p className="text-xs text-muted-foreground">
              The agent presents drafted touchpoints in the thread for review before publishing. Toggle off for full autonomous execution.
            </p>
          </div>
          <Switch
            id="nurture-approval"
            checked={value.requireApproval}
            onCheckedChange={(requireApproval) =>
              onChange({ ...value, requireApproval })
            }
            disabled={disabled}
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="nurture-auto-achieve" className="text-sm">
              Auto-achieve on milestone
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically advances contact goal status to &ldquo;Achieved&rdquo; when a follow-back or repost milestone is confirmed on live social feeds.
            </p>
          </div>
          <Switch
            id="nurture-auto-achieve"
            checked={value.autoAchieveOnMilestone}
            onCheckedChange={(autoAchieveOnMilestone) =>
              onChange({ ...value, autoAchieveOnMilestone })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
