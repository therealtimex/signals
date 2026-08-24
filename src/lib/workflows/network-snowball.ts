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

  return {
    seedType,
    seedValue: typeof config.seedValue === "string" ? config.seedValue.trim() : "",
    focus,
    maxContacts: clampNetworkSnowballSlider("maxContacts", config.maxContacts),
    maxHops: clampNetworkSnowballSlider("maxHops", config.maxHops),
    targetPlatform,
    autoLinkGraphEdges: typeof config.autoLinkGraphEdges === "boolean" ? config.autoLinkGraphEdges : true,
    requireApproval: typeof config.requireApproval === "boolean" ? config.requireApproval : false,
  };
}

export function buildNetworkSnowballRunConfig(
  config: NetworkSnowballConfig,
): Record<string, unknown> {
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
    `    - Advocates: Extract high-profile engineers quote-posting with domain proof or product endorsements.`,
    "S3. Bot & Clone Filter Gate: Apply the 'Engage for visibility, skip for contacts' rule. Discard automated news bots, clone mirror accounts, and impersonal aggregators (*bot, *daily, *digest) from contacts.csv.",
    "S4. Profile Hydration & Avatar Capture: For each qualifying human contact, extract full public profile details: name, handle, profile picture image URL (avatar_url), bio/headline, current company, and role.",
    `S5. Write Back & Graph Edge Linking: Stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_handle,profile_url,avatar_url,notes) and commit with:`,
    `    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe`,
    "    In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO').",
    "S6. Report Progress: Provide a concise summary table in this thread listing discovered contacts, their roles, avatar URLs, and platform links.",
  ];

  return lines.join("\n");
}
