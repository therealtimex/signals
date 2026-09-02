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
import { isPlatform } from "@/lib/db/platforms";
import {
  applyNurtureApprovalGate,
  resolveNurtureApprovalGate,
  type NurtureApprovalGate,
} from "@/lib/workflows/nurture-approval-gate";
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
  /** Test seam for the future publish-capable operator-choice state. */
  approvalGateOverride?: NurtureApprovalGate;
}

function platformLabel(platform: string | null): string {
  if (platform === "linkedin") return "LinkedIn";
  if (platform === "facebook") return "Facebook";
  if (platform === "x") return "X";
  return "the selected platforms";
}

function surfaceLabel(surface: string): string {
  const [platform, kind] = surface.split("/");
  const platformName = platformLabel(platform);
  const kindName = kind === "direct_message" ? "DM" : kind === "reply" ? "reply" : "comment";
  return `${platformName} ${kindName}`;
}

export function ContactNurtureFields({
  value,
  onChange,
  disabled,
  approvalGateOverride,
}: ContactNurtureFieldsProps) {
  const targets = useActingTargets();
  const selectedTarget = targets?.find((target) => target.id === value.targetId) ?? null;
  const selectedPlatform = selectedTarget && isPlatform(selectedTarget.platform)
    ? selectedTarget.platform
    : null;
  const gate = approvalGateOverride ?? resolveNurtureApprovalGate(selectedPlatform);

  const emit = useCallback(
    (next: ContactNurtureConfig) => {
      const nextTarget = targets?.find((target) => target.id === next.targetId) ?? null;
      const nextPlatform = nextTarget && isPlatform(nextTarget.platform) ? nextTarget.platform : null;
      onChange(applyNurtureApprovalGate(next, resolveNurtureApprovalGate(nextPlatform)));
    },
    [onChange, targets],
  );

  const setSlider = useCallback(
    (key: ContactNurtureSliderKey, next: number) => {
      emit({ ...value, [key]: clampContactNurtureSlider(key, next) });
    },
    [emit, value],
  );

  return (
    <div className="space-y-4">
      {/* Acting profile selector */}
      <div className="space-y-2">
        <Label htmlFor="nurture-target">Acting profile</Label>
        <Select
          value={value.targetId ?? ""}
          onValueChange={(next) => emit({ ...value, targetId: next })}
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
            emit({
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
          hint="Maximum comments, spotlights, or DMs to propose in this run."
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
        <div
          className="space-y-2 rounded-lg border bg-muted/20 p-3"
          data-testid="nurture-approval-gate"
          data-mode={gate.mode}
          data-reason={gate.reason}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5 pr-3">
              <Label htmlFor="nurture-approval" className="text-sm">
                Require approval before anything is sent
              </Label>
              <p id="nurture-approval-reason" className="text-xs text-muted-foreground">
                {gate.mode === "locked_explicit"
                  ? `Locked: every nurture surface on ${platformLabel(gate.platform)} is draft-only. The agent drafts and audits; you approve each proposal in the thread or on the run page.`
                  : "Public surfaces with a publish adapter may run without a second prompt. Direct messages always require explicit approval."}
              </p>
            </div>
            <Switch
              id="nurture-approval"
              aria-describedby="nurture-approval-reason"
              checked={gate.mode === "locked_explicit" ? true : value.requireApproval}
              onCheckedChange={(requireApproval) =>
                emit({ ...value, requireApproval })
              }
              disabled={disabled || gate.mode === "locked_explicit"}
            />
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {gate.surfaces.map((surface) => (
              <div
                key={surface.surface}
                data-testid="nurture-approval-surface"
                className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5"
              >
                <span>{surfaceLabel(surface.surface)}</span>
                <span className="text-right">
                  Draft only · {surface.reason === "explicit_floor" ? "always explicit" : surface.approval === "explicit" ? "approval required" : "operator choice"}
                </span>
              </div>
            ))}
          </div>
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
              emit({ ...value, autoAchieveOnMilestone })
            }
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
