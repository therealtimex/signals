"use client";

import { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BoundedSlider } from "@/app/dashboard/workflows/workflow-config-fields";
import {
  NETWORK_SNOWBALL_SLIDERS,
  clampNetworkSnowballSlider,
  type NetworkSnowballConfig,
  type NetworkSnowballSliderKey,
  type SnowballFocusType,
  type SnowballSeedType,
} from "@/lib/workflows/network-snowball";
import {
  FOLLOW_ON_ACTION_OPTIONS,
  type FollowOnActionType,
} from "@/lib/workflows/chaining";

interface NetworkSnowballFieldsProps {
  value: NetworkSnowballConfig;
  onChange: (next: NetworkSnowballConfig) => void;
  disabled?: boolean;
}

export function NetworkSnowballFields({
  value,
  onChange,
  disabled,
}: NetworkSnowballFieldsProps) {
  const setSlider = useCallback(
    (key: NetworkSnowballSliderKey, next: number) => {
      onChange({ ...value, [key]: clampNetworkSnowballSlider(key, next) });
    },
    [onChange, value],
  );

  return (
    <div className="space-y-4">
      {/* Expansion Focus */}
      <div className="space-y-2">
        <Label htmlFor="snowball-focus">Expansion focus</Label>
        <Select
          value={value.focus}
          onValueChange={(next) =>
            onChange({
              ...value,
              focus: next as SnowballFocusType,
            })
          }
          disabled={disabled}
        >
          <SelectTrigger id="snowball-focus">
            <SelectValue placeholder="Select expansion focus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="investors_and_angels">
              💼 Backers & Investors (Lead VCs, participating funds, angels)
            </SelectItem>
            <SelectItem value="founding_team">
              👥 Founding Team (Co-founders, CTO, core engineers)
            </SelectItem>
            <SelectItem value="ecosystem_advocates">
              🚀 Ecosystem Advocates (Technical quoters, power users)
            </SelectItem>
            <SelectItem value="all_connected">
              🌐 All Connected Nodes (Combined ecosystem)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Seed Type & Value */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor="snowball-seed-type">Seed source</Label>
          <Select
            value={value.seedType}
            onValueChange={(next) =>
              onChange({
                ...value,
                seedType: next as SnowballSeedType,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id="snowball-seed-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="event_url">Post / Event URL</SelectItem>
              <SelectItem value="contact_id">Contact Handle / ID</SelectItem>
              <SelectItem value="org_id">Organization Name</SelectItem>
              <SelectItem value="topic_search">Topic / Round Query</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="snowball-seed-value">
            {value.seedType === "event_url"
              ? "Announcement URL"
              : value.seedType === "contact_id"
                ? "Founder / Contact handle or ID"
                : value.seedType === "org_id"
                  ? "Startup / Organization name"
                  : "Search query"}
          </Label>
          <Input
            id="snowball-seed-value"
            placeholder={
              value.seedType === "event_url"
                ? "https://x.com/founder/status/..."
                : value.seedType === "contact_id"
                  ? "@founder_handle or contact ID"
                  : value.seedType === "org_id"
                    ? "Acme AI"
                    : "e.g. Series A AI agents"
            }
            value={value.seedValue}
            onChange={(e) => onChange({ ...value, seedValue: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Target Platform */}
      <div className="space-y-2">
        <Label htmlFor="snowball-platform">Target platform</Label>
        <Select
          value={value.targetPlatform}
          onValueChange={(next) =>
            onChange({
              ...value,
              targetPlatform: next as "all" | "x" | "linkedin",
            })
          }
          disabled={disabled}
        >
          <SelectTrigger id="snowball-platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cross-Platform (X & LinkedIn)</SelectItem>
            <SelectItem value="x">X / Twitter only</SelectItem>
            <SelectItem value="linkedin">LinkedIn only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sliders */}
      <div className="space-y-4 pt-2">
        <BoundedSlider
          id="snowball-max-contacts"
          label="Maximum contacts to map"
          bounds={NETWORK_SNOWBALL_SLIDERS.maxContacts}
          value={value.maxContacts}
          format={(v) => `${v} contact${v === 1 ? "" : "s"}`}
          onChange={(next) => setSlider("maxContacts", next)}
          disabled={disabled}
        />

        <BoundedSlider
          id="snowball-max-hops"
          label="Network depth"
          bounds={NETWORK_SNOWBALL_SLIDERS.maxHops}
          value={value.maxHops}
          format={(v) => `${v} hop${v === 1 ? "" : "s"}`}
          onChange={(next) => setSlider("maxHops", next)}
          disabled={disabled}
        />
      </div>

      {/* Auto-commit Toggle */}
      <div className="flex items-center justify-between pt-2">
        <div className="space-y-0.5">
          <Label htmlFor="snowball-auto-commit">Auto-commit to CRM</Label>
          <p className="text-xs text-muted-foreground">
            Automatically add discovered contacts directly to Signals CRM. Turn off to review candidates in the agent thread first.
          </p>
        </div>
        <Switch
          id="snowball-auto-commit"
          checked={!value.requireApproval}
          onCheckedChange={(autoCommit) => onChange({ ...value, requireApproval: !autoCommit })}
          disabled={disabled}
        />
      </div>

      {/* Follow-on Action (Workflow Cascade) */}
      <div className="space-y-2 pt-2 border-t">
        <Label htmlFor="snowball-follow-on">Follow-on Action (Workflow Snowballing)</Label>
        <p className="text-xs text-muted-foreground">
          Automatically cascade newly discovered contacts into follow-on enrichment or outreach workflows upon completion.
        </p>
        <Select
          value={value.followOnAction ?? "none"}
          onValueChange={(next) =>
            onChange({
              ...value,
              followOnAction: next as FollowOnActionType,
            })
          }
          disabled={disabled}
        >
          <SelectTrigger id="snowball-follow-on">
            <SelectValue placeholder="Select follow-on workflow" />
          </SelectTrigger>
          <SelectContent>
            {FOLLOW_ON_ACTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.followOnAction && value.followOnAction !== "none" && (
        <div className="space-y-2">
          <Label htmlFor="snowball-cascade-policy">Cascade policy</Label>
          <Select
            value={value.cascadePolicy ?? "immediate"}
            onValueChange={(next) =>
              onChange({
                ...value,
                cascadePolicy: next as "immediate" | "supervised",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id="snowball-cascade-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">⚡ Immediate — auto-trigger on completion</SelectItem>
              <SelectItem value="supervised">🛡️ Supervised — prompt for confirmation in thread</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
