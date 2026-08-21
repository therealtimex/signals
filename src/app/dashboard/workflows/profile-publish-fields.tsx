"use client";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  MAX_INSTRUCTIONS_LENGTH,
  MAX_PUBLISH_TARGETS,
  PROFILE_PUBLISH_SLIDERS,
  PROFILE_PUBLISH_TONES,
  clampProfilePublishSlider,
  readProfilePublishTone,
  type ProfilePublishConfig,
} from "@/lib/workflows/profile-publish";

interface ProfilePublishFieldsProps {
  value: ProfilePublishConfig;
  onChange: (next: ProfilePublishConfig) => void;
  disabled?: boolean;
}

export function ProfilePublishFields({
  value,
  onChange,
  disabled,
}: ProfilePublishFieldsProps) {
  const targets = useActingTargets();
  const selectedIds = new Set(value.targetIds);
  const atTargetCap = value.targetIds.length >= MAX_PUBLISH_TARGETS;

  function toggleTarget(targetId: string, checked: boolean) {
    if (!checked) {
      onChange({ ...value, targetIds: value.targetIds.filter((id) => id !== targetId) });
      return;
    }
    if (selectedIds.has(targetId) || atTargetCap) return;
    onChange({ ...value, targetIds: [...value.targetIds, targetId] });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Publish to</Label>
        {targets === null ? (
          <p className="text-xs text-muted-foreground">Loading profiles…</p>
        ) : targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No acting profiles registered.{" "}
            <Link href="/dashboard/settings" className="underline">
              Connect a browser session in Settings
            </Link>{" "}
            first.
          </p>
        ) : (
          <div className="space-y-2 rounded-lg border p-3">
            {targets.map((target) => {
              const checked = selectedIds.has(target.id);
              return (
                <div key={target.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`publish-target-${target.id}`}
                    checked={checked}
                    disabled={disabled || (!checked && atTargetCap)}
                    onCheckedChange={(next) => toggleTarget(target.id, next === true)}
                  />
                  <Label
                    htmlFor={`publish-target-${target.id}`}
                    className="text-sm font-normal"
                  >
                    {actingTargetLabel(target)}
                  </Label>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              {value.targetIds.length > 1
                ? `Cross-posting to ${value.targetIds.length} profiles — the agent adapts the format per platform.`
                : "Select one or more profiles to cross-post the same idea in each platform's native shape."}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="publish-instructions">Custom instructions</Label>
        <Textarea
          id="publish-instructions"
          rows={5}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
          placeholder="Raw thoughts, bullet points, release notes, or prompt guidance…"
          value={value.instructions}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, instructions: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          This is the source material the agent drafts from.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="publish-source-folder">Source material &amp; assets folder</Label>
        <Input
          id="publish-source-folder"
          placeholder="~/Documents/content-vault/launch-notes"
          value={value.sourceFolderPath ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, sourceFolderPath: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Optional. The agent reads .md and .txt notes for context and attaches matching
          .png/.jpg assets.
        </p>
      </div>

      <div className="space-y-3 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">Publishing budget</p>

        <BoundedSlider
          id="publish-original-posts"
          label="Original timeline posts"
          bounds={PROFILE_PUBLISH_SLIDERS.maxOriginalPosts}
          value={value.maxOriginalPosts}
          onChange={(next) =>
            onChange({
              ...value,
              maxOriginalPosts: clampProfilePublishSlider("maxOriginalPosts", next),
            })
          }
          disabled={disabled}
          format={(v) => (v === 1 ? "1 post" : `${v} posts`)}
          hint={
            value.maxOriginalPosts === 0
              ? "Curation only — the agent quotes and reposts without publishing anything original."
              : "Per selected profile."
          }
        />

        <BoundedSlider
          id="publish-reposts"
          label="Curated reposts / quote posts"
          bounds={PROFILE_PUBLISH_SLIDERS.maxReposts}
          value={value.maxReposts}
          onChange={(next) =>
            onChange({ ...value, maxReposts: clampProfilePublishSlider("maxReposts", next) })
          }
          disabled={disabled}
          format={(v) => (v === 1 ? "1 repost" : `${v} reposts`)}
          hint={
            value.maxReposts === 0 ? "Original posts only — nothing gets quoted or reposted." : undefined
          }
        />
      </div>

      <TagListField
        id="publish-topics"
        label="Topics &amp; themes"
        placeholder="ai-agents, local-first, crm — then Enter"
        emptyHint="No topics set — the agent follows your instructions above."
        tags={value.topics}
        onChange={(topics) => onChange({ ...value, topics })}
        disabled={disabled}
      />

      <div className="space-y-2">
        <Label htmlFor="publish-tone">Tone of voice</Label>
        <Select
          value={value.tone}
          onValueChange={(next) => onChange({ ...value, tone: readProfilePublishTone(next) })}
          disabled={disabled}
        >
          <SelectTrigger id="publish-tone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILE_PUBLISH_TONES.map((tone) => (
              <SelectItem key={tone.value} value={tone.value}>
                {tone.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="publish-approval" className="text-sm">
            Require confirmation before publishing
          </Label>
          <p className="text-xs text-muted-foreground">
            The agent renders every draft in the thread and waits for your go-ahead.
          </p>
        </div>
        <Switch
          id="publish-approval"
          checked={value.requireApproval}
          onCheckedChange={(requireApproval) => onChange({ ...value, requireApproval })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
