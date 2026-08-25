"use client";

import { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BoundedSlider,
  TagListField,
} from "@/app/dashboard/workflows/workflow-config-fields";
import {
  SNOWBALL_SEED_SCOUT_PLATFORMS,
  SNOWBALL_SEED_SCOUT_SLIDERS,
  clampSnowballSeedScoutSlider,
  type SnowballSeedScoutConfig,
  type SnowballSeedScoutPlatform,
  type SnowballSeedScoutSliderKey,
} from "@/lib/workflows/snowball-seed-scout";

interface SnowballSeedScoutFieldsProps {
  value: SnowballSeedScoutConfig;
  onChange: (next: SnowballSeedScoutConfig) => void;
  disabled?: boolean;
}

export function SnowballSeedScoutFields({
  value,
  onChange,
  disabled,
}: SnowballSeedScoutFieldsProps) {
  const setSlider = useCallback(
    (key: SnowballSeedScoutSliderKey, next: number) => {
      onChange({ ...value, [key]: clampSnowballSeedScoutSlider(key, next) });
    },
    [onChange, value],
  );

  const togglePlatform = (platform: SnowballSeedScoutPlatform) => {
    const set = new Set(value.platforms);
    if (set.has(platform)) {
      if (set.size === 1) return;
      set.delete(platform);
    } else {
      set.add(platform);
    }
    onChange({ ...value, platforms: [...set] });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Platforms (rotation)</Label>
        <div className="flex flex-wrap gap-2">
          {SNOWBALL_SEED_SCOUT_PLATFORMS.map((platform) => {
            const active = value.platforms.includes(platform);
            return (
              <button
                key={platform}
                type="button"
                disabled={disabled}
                onClick={() => togglePlatform(platform)}
                className={`rounded-md border px-2.5 py-1 text-xs capitalize transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {platform}
              </button>
            );
          })}
        </div>
      </div>

      <TagListField
        id="scout-communities"
        label="Communities / feed URLs"
        placeholder="Add group URL or feed link"
        tags={value.communities}
        onChange={(communities) => onChange({ ...value, communities })}
        disabled={disabled}
      />

      <TagListField
        id="scout-search-queries"
        label="Search queries (optional)"
        placeholder="Add search phrase"
        tags={value.searchQueries}
        onChange={(searchQueries) => onChange({ ...value, searchQueries })}
        disabled={disabled}
      />

      <TagListField
        id="scout-intent-keywords"
        label="Intent keywords"
        placeholder="funding, launch, seed round"
        tags={value.intentKeywords}
        onChange={(intentKeywords) => onChange({ ...value, intentKeywords })}
        disabled={disabled}
      />

      <div className="space-y-3 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">Harvest & queue</p>

        <BoundedSlider
          id="scout-max-links"
          label="Max links per run"
          bounds={SNOWBALL_SEED_SCOUT_SLIDERS.maxLinksPerRun}
          value={value.maxLinksPerRun}
          onChange={(next) => setSlider("maxLinksPerRun", next)}
          disabled={disabled}
          format={(v) => (v === 1 ? "1 link" : `${v} links`)}
        />

        <BoundedSlider
          id="scout-salt-min"
          label="Min queue delay (minutes)"
          bounds={SNOWBALL_SEED_SCOUT_SLIDERS.saltMinMinutes}
          value={value.saltMinMinutes}
          onChange={(next) => setSlider("saltMinMinutes", next)}
          disabled={disabled}
          format={(v) => `${v} min`}
        />

        <BoundedSlider
          id="scout-salt-max"
          label="Max queue delay (minutes)"
          bounds={SNOWBALL_SEED_SCOUT_SLIDERS.saltMaxMinutes}
          value={value.saltMaxMinutes}
          onChange={(next) => setSlider("saltMaxMinutes", next)}
          disabled={disabled}
          format={(v) => `${v} min`}
        />

        <BoundedSlider
          id="scout-interval"
          label="Heartbeat interval (hours)"
          bounds={SNOWBALL_SEED_SCOUT_SLIDERS.heartbeatIntervalHours}
          value={value.heartbeatIntervalHours}
          onChange={(next) => setSlider("heartbeatIntervalHours", next)}
          disabled={disabled}
          format={(v) => (v === 1 ? "Every hour" : `Every ${v} hours`)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor="scout-enabled">Heartbeat enabled</Label>
          <p className="text-xs text-muted-foreground">
            Disable to pause scheduled harvest without removing deploy files.
          </p>
        </div>
        <Switch
          id="scout-enabled"
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
