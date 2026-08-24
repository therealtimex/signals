/**
 * "Network Snowball" — an event-driven network expansion workflow executed in the Terminal Agent lane.
 *
 * It starts from a high-signal seed entity or announcement (funding round, product launch, or executive hire),
 * rolls outward along causal relationship edges to discover second-degree connected high-value nodes
 * (investors, angels, co-founders, and technical advocates), filters out bots, extracts profile avatars,
 * and links them into the Signals relationship graph.
 */

import {
  clampSlider,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";
import {
  buildWorkflowCascadeConfig,
  CASCADE_CONFIG_KEY,
  readWorkflowCascadeConfig,
  type FollowOnActionType,
} from "@/lib/workflows/cascade-types";

export const NETWORK_SNOWBALL_TEMPLATE_NAME = "Network Snowball";

/** Marker key in template config. */
export const NETWORK_SNOWBALL_CONFIG_KEY = "networkSnowball";

export const NETWORK_SNOWBALL_CONFIG_VERSION = 1;

export type SnowballSeedType = "event_url" | "contact_id" | "org_id" | "topic_search";
export type SnowballFocusType =
  | "investors_and_angels"
  | "founding_team"
  | "ecosystem_advocates"
  | "all_connected";

export const SNOWBALL_SEED_TYPES: readonly SnowballSeedType[] = [
  "event_url",
  "contact_id",
  "org_id",
  "topic_search",
];

export const SNOWBALL_FOCUS_TYPES: readonly SnowballFocusType[] = [
  "investors_and_angels",
  "founding_team",
  "ecosystem_advocates",
  "all_connected",
];

export type NetworkSnowballSliderKey = "maxContacts" | "maxHops";

export const NETWORK_SNOWBALL_SLIDERS: Record<NetworkSnowballSliderKey, SliderBounds> = {
  maxContacts: { min: 1, max: 30, step: 1, fallback: 10 },
  maxHops: { min: 1, max: 2, step: 1, fallback: 1 },
};

export interface NetworkSnowballConfig {
  seedType: SnowballSeedType;
  seedValue: string;
  focus: SnowballFocusType;
  maxContacts: number;
  maxHops: number;
  targetPlatform: "x" | "linkedin" | "all";
  autoLinkGraphEdges: boolean;
  requireApproval: boolean;
  followOnActions?: FollowOnActionType[];
  followOnAction?: FollowOnActionType;
  cascadePolicy?: "immediate" | "supervised";
}

export function isNetworkSnowballTemplateConfig(config: Record<string, unknown>): boolean {
  return Boolean(config[NETWORK_SNOWBALL_CONFIG_KEY]);
}

export function clampNetworkSnowballSlider(
  key: NetworkSnowballSliderKey,
  value: unknown,
): number {
  return clampSlider(NETWORK_SNOWBALL_SLIDERS[key], value);
}

export function readNetworkSnowballConfig(
  config: Record<string, unknown>,
): NetworkSnowballConfig {
  const seedType = typeof config.seedType === "string" &&
    (SNOWBALL_SEED_TYPES as readonly string[]).includes(config.seedType)
      ? (config.seedType as SnowballSeedType)
      : "event_url";

  const focus = typeof config.focus === "string" &&
    (SNOWBALL_FOCUS_TYPES as readonly string[]).includes(config.focus)
      ? (config.focus as SnowballFocusType)
      : "investors_and_angels";

  const targetPlatform = typeof config.targetPlatform === "string" &&
    ["x", "linkedin", "all"].includes(config.targetPlatform)
      ? (config.targetPlatform as "x" | "linkedin" | "all")
      : "all";

  const cascade = readWorkflowCascadeConfig(config);

  return {
    seedType,
    seedValue: typeof config.seedValue === "string" ? config.seedValue.trim() : "",
    focus,
    maxContacts: clampNetworkSnowballSlider("maxContacts", config.maxContacts),
    maxHops: clampNetworkSnowballSlider("maxHops", config.maxHops),
    targetPlatform,
    autoLinkGraphEdges: typeof config.autoLinkGraphEdges === "boolean" ? config.autoLinkGraphEdges : true,
    requireApproval: typeof config.requireApproval === "boolean" ? config.requireApproval : false,
    followOnActions: cascade.followOnActions,
    followOnAction: cascade.followOnActions[0],
    cascadePolicy: cascade.cascadePolicy,
  };
}

export function buildNetworkSnowballRunConfig(
  config: NetworkSnowballConfig,
): Record<string, unknown> {
  const followOnActions = config.followOnActions ?? (config.followOnAction ? [config.followOnAction] : []);
  return {
    [NETWORK_SNOWBALL_CONFIG_KEY]: { version: NETWORK_SNOWBALL_CONFIG_VERSION },
    seedType: config.seedType,
    seedValue: config.seedValue,
    focus: config.focus,
    maxContacts: clampNetworkSnowballSlider("maxContacts", config.maxContacts),
    maxHops: clampNetworkSnowballSlider("maxHops", config.maxHops),
    targetPlatform: config.targetPlatform,
    autoLinkGraphEdges: config.autoLinkGraphEdges,
    requireApproval: config.requireApproval,
    [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
      followOnActions,
      cascadePolicy: config.cascadePolicy ?? "immediate",
    }),
  };
}

export function buildNetworkSnowballTemplateConfig(): Record<string, unknown> {
  return {
    [NETWORK_SNOWBALL_CONFIG_KEY]: { version: NETWORK_SNOWBALL_CONFIG_VERSION },
    seedType: "event_url",
    seedValue: "",
    focus: "investors_and_angels",
    maxContacts: 10,
    maxHops: 1,
    targetPlatform: "all",
    autoLinkGraphEdges: true,
    requireApproval: false,
    [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
      followOnActions: [],
      cascadePolicy: "immediate",
    }),
  };
}

export function buildNetworkSnowballBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl?: string;
}): string {
  const snowball = readNetworkSnowballConfig(input.config);
  const seedDescriptor = snowball.seedValue
    ? `"${snowball.seedValue}" (${snowball.seedType})`
    : `the target entity provided in this run (${snowball.seedType})`;

  const focusDescriptions: Record<SnowballFocusType, string> = {
    investors_and_angels: "Lead VCs, participating funds, and angel investors",
    founding_team: "Co-founders, CTO, founding engineers, and key executives",
    ecosystem_advocates: "High-signal developers, quoter accounts, and technical testimonials",
    all_connected: "Investors, founding team members, and prominent ecosystem advocates",
  };

  const lines = [
    "Network Snowball execution contract:",
    `S0. Objective: Roll the network outward from seed signal ${seedDescriptor} to discover and map up to ${snowball.maxContacts} connected contact(s) focusing on ${focusDescriptions[snowball.focus]} (max depth: ${snowball.maxHops} hop(s)).`,
    "S1. Inspect Seed Signal: Connect over CDP via agent-browser to navigate to the seed post URL, profile, or organization. Parse the core event context (e.g. Funding round amount, launch specs, executive hire, or partnership announcement).",
    `S2. Discover Connected Nodes: Traverse 1st-degree relational edges from the seed entity:`,
    `    - Backers / Investors: Extract tagged partner handles, mentioned VC funds, and congratulatory angels in replies.`,
    `    - Founding Team: Extract co-founders, CTO, and core team members mentioned or linked in the entity bio.`,
    "S3. Anti-Hallucination & Bot Filter Gate:",
    "    - Anti-Hallucination Rule: Never guess or synthesize vanity profile URLs (e.g. guessing https://linkedin.com/in/<name> from a person's name). Only attach a profile URL or handle if it was explicitly extracted from the page links/DOM or verified via direct search. If unverified, leave profile_url blank rather than mapping to a wrong individual.",
    "    - Bot/Clone Filter: Apply the 'Engage for visibility, skip for contacts' rule. Discard automated news bots, clone mirror accounts, and impersonal aggregators (*bot, *daily, *digest) from contacts.csv.",
    "S4. Identity-First Avatar Extraction: Prioritize extracting authentic profile photo assets directly from each contact's primary identity (e.g. visit their LinkedIn profile over CDP for media.licdn.com, X for pbs.twimg.com, or YC/company directory for Bookface/CDN photos). Verify that avatar_url is a direct, permanent image asset (HTTP 200). Never guess synthetic redirecting URLs.",
    snowball.requireApproval
      ? `S5. Approval & Write Back: Candidate roster must be presented in this thread for operator review before bulk committing. Once confirmed, stage workflow-runs/${input.workflowRunId}/contacts.csv and commit with:\n    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe\n    In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO').`
      : `S5. Write Back & Graph Edge Linking: Stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_handle,profile_url,avatar_url,notes) and commit with:\n    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe\n    In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO').`,
    "S6. Report Progress: Provide a concise summary table in this thread listing discovered contacts, their roles, avatar URLs, and platform links.",
    "S7. Teardown & Resource Release:",
    "    - Terminate Spawned Browser Sessions: Immediately stop/close any browser sessions opened during this run (agent-browser close / realtimex-pp-cli browser-session stop) to release Chromium RAM and CPU.",
    "    - Terminate Agent Session: Conclude the run cleanly so no zombie terminal processes or background threads persist in RealTimeX.",
  ];

  return lines.join("\n");
}
