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
import {
  BoundedSlider,
  TagListField,
} from "@/app/dashboard/workflows/workflow-config-fields";
import {
  SOCIAL_PATROL_SLIDERS,
  clampSocialPatrolSlider,
  socialPatrolLeaseTtlSeconds,
  type SocialPatrolConfig,
  type SocialPatrolSliderKey,
} from "@/lib/workflows/social-patrol";

interface SocialPatrolFieldsProps {
  value: SocialPatrolConfig;
  onChange: (next: SocialPatrolConfig) => void;
  disabled?: boolean;
}

export function SocialPatrolFields({ value, onChange, disabled }: SocialPatrolFieldsProps) {
  const targets = useActingTargets();

  const setSlider = useCallback(
    (key: SocialPatrolSliderKey, next: number) => {
      onChange({ ...value, [key]: clampSocialPatrolSlider(key, next) });
    },
    [onChange, value],
  );

  const leaseTtlMinutes = Math.round(
    socialPatrolLeaseTtlSeconds(value.durationMinutes) / 60,
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="patrol-target">Acting profile</Label>
        <Select
          value={value.targetId ?? ""}
          onValueChange={(next) => onChange({ ...value, targetId: next })}
          disabled={disabled || !targets?.length}
        >
          <SelectTrigger id="patrol-target">
            <SelectValue
              placeholder={targets === null ? "Loading profiles…" : "Select an acting profile"}
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

      <div className="space-y-3 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">Shift budget</p>

        <BoundedSlider
          id="patrol-duration"
          label="Session duration"
          bounds={SOCIAL_PATROL_SLIDERS.durationMinutes}
          value={value.durationMinutes}
          onChange={(next) => setSlider("durationMinutes", next)}
          disabled={disabled}
          format={(v) => `${v} min`}
          hint={`Browser lease TTL is capped at ${leaseTtlMinutes} min — longer shifts renew the lease.`}
        />

        <BoundedSlider
          id="patrol-comments"
          label="High-intent comments"
          bounds={SOCIAL_PATROL_SLIDERS.maxComments}
          value={value.maxComments}
          onChange={(next) => setSlider("maxComments", next)}
          disabled={disabled}
          format={(v) => (v === 1 ? "1 comment" : `${v} comments`)}
          hint={
            value.maxComments === 0
              ? "Scan & ingest only — the agent reads the communities without replying."
              : undefined
          }
        />

        <BoundedSlider
          id="patrol-contacts"
          label="Max engagers to ingest"
          bounds={SOCIAL_PATROL_SLIDERS.maxScrapedContacts}
          value={value.maxScrapedContacts}
          onChange={(next) => setSlider("maxScrapedContacts", next)}
          disabled={disabled}
          format={(v) => `${v} contacts`}
        />
      </div>

      <TagListField
        id="patrol-communities"
        label="Monitored communities"
        placeholder="Group name or feed URL, then Enter"
        emptyHint="No communities set — the agent patrols the acting profile's own feed."
        tags={value.communities}
        onChange={(communities) => onChange({ ...value, communities })}
        disabled={disabled}
      />

      <TagListField
        id="patrol-keywords"
        label="Intent keywords"
        placeholder="Keyword, then Enter"
        tags={value.intentKeywords}
        onChange={(intentKeywords) => onChange({ ...value, intentKeywords })}
        disabled={disabled}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="patrol-approval" className="text-sm">
            Require confirmation before publishing comments
          </Label>
          <p className="text-xs text-muted-foreground">
            The agent posts each drafted comment in the thread and waits for your go-ahead.
          </p>
        </div>
        <Switch
          id="patrol-approval"
          checked={value.requireApproval}
          onCheckedChange={(requireApproval) => onChange({ ...value, requireApproval })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
