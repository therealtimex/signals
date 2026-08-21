"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { actingTargetLabel } from "@/app/dashboard/workflows/activate-dialog.utils";
import {
  MAX_TAG_COUNT,
  SOCIAL_PATROL_SLIDERS,
  clampSocialPatrolSlider,
  normalizeTagList,
  socialPatrolLeaseTtlSeconds,
  type SocialPatrolConfig,
  type SocialPatrolSliderKey,
} from "@/lib/workflows/social-patrol";

type ActingTarget = {
  id: string;
  platform: string;
  name: string;
  handle: string | null;
  status: string;
};

interface SocialPatrolFieldsProps {
  value: SocialPatrolConfig;
  onChange: (next: SocialPatrolConfig) => void;
  disabled?: boolean;
}

export function SocialPatrolFields({ value, onChange, disabled }: SocialPatrolFieldsProps) {
  const [targets, setTargets] = useState<ActingTarget[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/platform-targets", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { targets?: ActingTarget[] }) => {
        setTargets((data.targets ?? []).filter((t) => t.status === "active"));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTargets([]);
      });
    return () => controller.abort();
  }, []);

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

        <PatrolSlider
          id="patrol-duration"
          label="Session duration"
          sliderKey="durationMinutes"
          value={value.durationMinutes}
          onChange={setSlider}
          disabled={disabled}
          format={(v) => `${v} min`}
          hint={`Browser lease TTL is capped at ${leaseTtlMinutes} min — longer shifts renew the lease.`}
        />

        <PatrolSlider
          id="patrol-comments"
          label="High-intent comments"
          sliderKey="maxComments"
          value={value.maxComments}
          onChange={setSlider}
          disabled={disabled}
          format={(v) => (v === 1 ? "1 comment" : `${v} comments`)}
          hint={
            value.maxComments === 0
              ? "Scan & ingest only — the agent reads the communities without replying."
              : undefined
          }
        />

        <PatrolSlider
          id="patrol-contacts"
          label="Max engagers to ingest"
          sliderKey="maxScrapedContacts"
          value={value.maxScrapedContacts}
          onChange={setSlider}
          disabled={disabled}
          format={(v) => `${v} contacts`}
        />
      </div>

      <TagField
        id="patrol-communities"
        label="Monitored communities"
        placeholder="Group name or feed URL, then Enter"
        emptyHint="No communities set — the agent patrols the acting profile's own feed."
        tags={value.communities}
        onChange={(communities) => onChange({ ...value, communities })}
        disabled={disabled}
      />

      <TagField
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

interface PatrolSliderProps {
  id: string;
  label: string;
  sliderKey: SocialPatrolSliderKey;
  value: number;
  onChange: (key: SocialPatrolSliderKey, next: number) => void;
  disabled?: boolean;
  format: (value: number) => string;
  hint?: string;
}

function PatrolSlider({
  id,
  label,
  sliderKey,
  value,
  onChange,
  disabled,
  format,
  hint,
}: PatrolSliderProps) {
  const { min, max, step } = SOCIAL_PATROL_SLIDERS[sliderKey];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs font-medium tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(sliderKey, Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface TagFieldProps {
  id: string;
  label: string;
  placeholder: string;
  emptyHint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

function TagField({
  id,
  label,
  placeholder,
  emptyHint,
  tags,
  onChange,
  disabled,
}: TagFieldProps) {
  const [draft, setDraft] = useState("");
  const atCap = tags.length >= MAX_TAG_COUNT;

  function commitDraft() {
    if (!draft.trim()) return;
    const next = normalizeTagList([...tags, ...draft.split(",")]);
    onChange(next);
    // Keep the text when nothing was accepted (at the cap, or a duplicate) so the entry does
    // not vanish without explanation.
    if (next.length > tags.length) setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        placeholder={atCap ? `Limit of ${MAX_TAG_COUNT} reached` : placeholder}
        disabled={disabled || atCap}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Enter adds a tag here; it must not submit the surrounding dialog.
          e.preventDefault();
          commitDraft();
        }}
      />
      {atCap && (
        <p className="text-xs text-muted-foreground">
          Limit of {MAX_TAG_COUNT} reached — remove one to add another.
        </p>
      )}
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70 disabled:opacity-50"
            >
              {tag}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove {tag}</span>
            </button>
          ))}
        </div>
      ) : (
        emptyHint && <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  );
}
