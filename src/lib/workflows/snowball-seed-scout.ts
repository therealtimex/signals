/**
 * "Snowball Seed Scout" — deterministic link harvest deployed as a RealTimeX heartbeat shell task.
 *
 * The Signals template is a deployment surface (defaults + settings UI), not a terminal-agent run.
 * Deploy writes scout.json + scripts into the RTX workspace and upserts a HEARTBEAT.md shell task.
 */

import {
  clampSlider,
  normalizeTagList,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";
import { NETWORK_SNOWBALL_TEMPLATE_NAME } from "@/lib/workflows/network-snowball";

export const SNOWBALL_SEED_SCOUT_TEMPLATE_NAME = "Snowball Seed Scout";

export const SNOWBALL_SEED_SCOUT_CONFIG_KEY = "snowballSeedScout";

export const SNOWBALL_SEED_SCOUT_CONFIG_VERSION = 1;

export const SNOWBALL_SEED_SCOUT_EXECUTION_KIND = "heartbeat_shell" as const;

export const SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME = "snowball-seed-scout";

export const SNOWBALL_SEED_SCOUT_WORKSPACE_REL_DIR = "scripts/snowball-seed-scout";

export const SNOWBALL_SEED_SCOUT_CONFIG_FILENAME = "scout.json";

export type SnowballSeedScoutPlatform = "x" | "linkedin" | "facebook";

export const SNOWBALL_SEED_SCOUT_PLATFORMS: readonly SnowballSeedScoutPlatform[] = [
  "x",
  "linkedin",
  "facebook",
];

export type SnowballSeedScoutSliderKey =
  | "maxLinksPerRun"
  | "saltMinMinutes"
  | "saltMaxMinutes"
  | "heartbeatIntervalHours";

export const SNOWBALL_SEED_SCOUT_SLIDERS: Record<
  SnowballSeedScoutSliderKey,
  SliderBounds
> = {
  maxLinksPerRun: { min: 1, max: 20, step: 1, fallback: 5 },
  saltMinMinutes: { min: 5, max: 120, step: 5, fallback: 10 },
  saltMaxMinutes: { min: 5, max: 180, step: 5, fallback: 15 },
  heartbeatIntervalHours: { min: 1, max: 168, step: 1, fallback: 4 },
};

export interface SnowballSeedScoutConfig {
  platforms: SnowballSeedScoutPlatform[];
  communities: string[];
  searchQueries: string[];
  intentKeywords: string[];
  maxLinksPerRun: number;
  saltMinMinutes: number;
  saltMaxMinutes: number;
  heartbeatIntervalHours: number;
  enabled: boolean;
  snowballFocus: string;
  networkSnowballTemplateName: string;
}

export interface SnowballSeedScoutDeploymentState extends SnowballSeedScoutConfig {
  version: number;
  deployedAt: string | null;
  templateId: string | null;
  heartbeatTaskName: string;
}

export function isSnowballSeedScoutTemplateConfig(
  config: Record<string, unknown>,
): boolean {
  return Boolean(config[SNOWBALL_SEED_SCOUT_CONFIG_KEY]);
}

export function isHeartbeatShellTemplateConfig(
  config: Record<string, unknown>,
): boolean {
  const marker = config[SNOWBALL_SEED_SCOUT_CONFIG_KEY];
  if (!marker || typeof marker !== "object") return false;
  const executionKind = (marker as Record<string, unknown>).executionKind;
  return executionKind === SNOWBALL_SEED_SCOUT_EXECUTION_KIND;
}

export function clampSnowballSeedScoutSlider(
  key: SnowballSeedScoutSliderKey,
  value: unknown,
): number {
  return clampSlider(SNOWBALL_SEED_SCOUT_SLIDERS[key], value);
}

function normalizePlatforms(value: unknown): SnowballSeedScoutPlatform[] {
  const entries = normalizeTagList(value);
  const allowed = new Set<string>(SNOWBALL_SEED_SCOUT_PLATFORMS);
  const platforms = entries.filter((entry): entry is SnowballSeedScoutPlatform =>
    allowed.has(entry),
  );
  return platforms.length > 0 ? platforms : ["x", "linkedin"];
}

export function readSnowballSeedScoutConfig(
  config: Record<string, unknown>,
): SnowballSeedScoutConfig {
  const saltMin = clampSnowballSeedScoutSlider("saltMinMinutes", config.saltMinMinutes);
  const saltMax = clampSnowballSeedScoutSlider("saltMaxMinutes", config.saltMaxMinutes);

  return {
    platforms: normalizePlatforms(config.platforms),
    communities: normalizeTagList(config.communities),
    searchQueries: normalizeTagList(config.searchQueries),
    intentKeywords: normalizeTagList(config.intentKeywords),
    maxLinksPerRun: clampSnowballSeedScoutSlider(
      "maxLinksPerRun",
      config.maxLinksPerRun,
    ),
    saltMinMinutes: Math.min(saltMin, saltMax),
    saltMaxMinutes: Math.max(saltMin, saltMax),
    heartbeatIntervalHours: clampSnowballSeedScoutSlider(
      "heartbeatIntervalHours",
      config.heartbeatIntervalHours,
    ),
    enabled: config.enabled !== false,
    snowballFocus:
      typeof config.snowballFocus === "string" && config.snowballFocus.trim()
        ? config.snowballFocus.trim()
        : "investors_and_angels",
    networkSnowballTemplateName:
      typeof config.networkSnowballTemplateName === "string" &&
      config.networkSnowballTemplateName.trim()
        ? config.networkSnowballTemplateName.trim()
        : NETWORK_SNOWBALL_TEMPLATE_NAME,
  };
}

export function buildSnowballSeedScoutTemplateConfig(): Record<string, unknown> {
  return {
    [SNOWBALL_SEED_SCOUT_CONFIG_KEY]: {
      version: SNOWBALL_SEED_SCOUT_CONFIG_VERSION,
      executionKind: SNOWBALL_SEED_SCOUT_EXECUTION_KIND,
    },
    platforms: ["x", "linkedin"],
    communities: [],
    searchQueries: [],
    intentKeywords: ["funding", "launch", "seed round", "raised"],
    maxLinksPerRun: SNOWBALL_SEED_SCOUT_SLIDERS.maxLinksPerRun.fallback,
    saltMinMinutes: SNOWBALL_SEED_SCOUT_SLIDERS.saltMinMinutes.fallback,
    saltMaxMinutes: SNOWBALL_SEED_SCOUT_SLIDERS.saltMaxMinutes.fallback,
    heartbeatIntervalHours:
      SNOWBALL_SEED_SCOUT_SLIDERS.heartbeatIntervalHours.fallback,
    enabled: true,
    snowballFocus: "investors_and_angels",
    networkSnowballTemplateName: NETWORK_SNOWBALL_TEMPLATE_NAME,
  };
}

export function buildSnowballSeedScoutDeployConfig(
  draft: SnowballSeedScoutConfig,
): Record<string, unknown> {
  const normalized = readSnowballSeedScoutConfig(draft as unknown as Record<string, unknown>);
  return {
    [SNOWBALL_SEED_SCOUT_CONFIG_KEY]: {
      version: SNOWBALL_SEED_SCOUT_CONFIG_VERSION,
      executionKind: SNOWBALL_SEED_SCOUT_EXECUTION_KIND,
    },
    ...normalized,
  };
}

export function formatHeartbeatInterval(hours: number): string {
  const normalized = clampSnowballSeedScoutSlider(
    "heartbeatIntervalHours",
    hours,
  );
  return `${normalized}h`;
}

export function toDeploymentState(
  config: SnowballSeedScoutConfig,
  options: {
    deployedAt?: string | null;
    templateId?: string | null;
  } = {},
): SnowballSeedScoutDeploymentState {
  return {
    version: SNOWBALL_SEED_SCOUT_CONFIG_VERSION,
    deployedAt: options.deployedAt ?? null,
    templateId: options.templateId ?? null,
    heartbeatTaskName: SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME,
    ...config,
  };
}

export function scoutConfigRelativePath(): string {
  return `${SNOWBALL_SEED_SCOUT_WORKSPACE_REL_DIR}/${SNOWBALL_SEED_SCOUT_CONFIG_FILENAME}`;
}

export function scoutShellCommandRelative(): string {
  return `bash ./${SNOWBALL_SEED_SCOUT_WORKSPACE_REL_DIR}/scout.sh`;
}
