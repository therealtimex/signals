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
import type { NetworkSnowballPreparedTarget } from "@/lib/workflows/network-snowball-target";

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
  templateId?: string;
  config: Record<string, unknown>;
  signalsBaseUrl?: string;
  snowballIdentityScopeToken?: string;
  browserTarget?: NetworkSnowballPreparedTarget;
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
  const attributionFlags = ` --workflow-run-id ${input.workflowRunId}${input.templateId ? ` --template-id ${input.templateId}` : ""}`;
  const identityScopeToken = input.snowballIdentityScopeToken ?? "<missing-dispatch-capability>";
  const browserTarget = input.browserTarget;
  const browserSessionName = browserTarget?.sessionName ?? "<missing-server-bound-session>";
  const verifiedBrowserIdentity =
    browserTarget?.verifiedHandle ?? browserTarget?.expectedHandle ?? "<missing-verified-identity>";
  const linkedInGateInstruction = browserTarget?.platform === "x"
    ? "    - Server-Enforced LinkedIn Gate: This is an X-only run with no bound LinkedIn target. Do not discover or write LinkedIn identities; Signals rejects LinkedIn attestation for this run."
    : `    - Server-Enforced LinkedIn Gate: Before writing any LinkedIn identity, call \`attest_snowball_linkedin_identity\` with the proposed \`/in/\` URL, candidate name, and at least one candidate company or title. Signals renews this run's lease and navigates the same bound session \`${browserSessionName}\` itself, re-verifies its authenticated identity, checks the final URL plus visible top-card evidence, and returns a short-lived one-use \`identityEvidenceToken\` only on a match.`;

  const lines = [
    "Network Snowball execution contract:",
    `S0. Objective: Roll the network outward from seed signal ${seedDescriptor} to discover and map up to ${snowball.maxContacts} connected contact(s) focusing on ${focusDescriptions[snowball.focus]} (max depth: ${snowball.maxHops} hop(s)).`,
    `S1. Inspect Seed Signal: Attach agent-browser over CDP to the already-running server-bound session named \`${browserSessionName}\` only. It was authenticated as ${browserTarget?.platform ?? "<missing-platform>"} identity \`${verifiedBrowserIdentity}\` before dispatch. Do not create, start, stop, delete, or substitute a browser session. Navigate in that session to the seed post URL, profile, or organization and parse the core event context (e.g. funding round amount, launch specs, executive hire, or partnership announcement).`,
    "    - Browser privacy boundary: Never read document.cookie, localStorage, sessionStorage, browser profile files, authorization headers, or other credential material. Use visible page content and links only.",
    "    - Workflow boundary: This is a data-plane run. Never inspect or edit the Signals source tree, package files, tests, or runtime implementation. If a workflow tool or identity gate fails, record the failure and finalize the run as partial/failed; do not patch around the gate.",
    `S2. Discover Connected Nodes: Traverse 1st-degree relational edges from the seed entity:`,
    `    - Backers / Investors: Extract tagged partner handles, mentioned VC funds, and congratulatory angels in replies.`,
    `    - Founding Team: Extract co-founders, CTO, and core team members mentioned or linked in the entity bio.`,
    "S3. Anti-Hallucination & Bot Filter Gate:",
    "    - Anti-Hallucination Rule: Never guess or synthesize vanity profile URLs (e.g. guessing https://linkedin.com/in/<name> from a person's name). Only attach a profile URL or handle if it was explicitly extracted from the page links/DOM or verified via direct search. If unverified, leave profile_url blank rather than mapping to a wrong individual.",
    linkedInGateInstruction,
    `    - snowballScopeToken: "${identityScopeToken}". Copy it exactly into each attestation call; it is bound to workflow run ${input.workflowRunId}. Never put this scope token in contacts.csv.`,
    "    - Use only the `platformUserId`, `platformHandle`, and `platformUrl` returned by attestation. Put its `identityEvidenceToken` in that candidate's `identity_evidence_token` CSV field (or the direct write's `identityEvidenceToken`). Keep the corroborated company/title unchanged through write-back; for a direct identity upsert, pass them as `candidateCompany` / `candidateTitle`. A same-name candidate with different context, or any rejected or expired candidate, must not be committed. Signals automatically saves every failed attestation as an `identity_unverified` quarantined person/company candidate; do not create a bare contact as a fallback. Use `list_snowball_candidates` to review or re-attempt those candidates later.",
    "    - Bot/Clone Filter: Apply the 'Engage for visibility, skip for contacts' rule. Discard automated news bots, clone mirror accounts, and impersonal aggregators (*bot, *daily, *digest) from contacts.csv.",
    "S4. Avatar Enrichment (downstream of identity attestation): For LinkedIn, read avatar only from `.pv-top-card-profile-picture__image` on the attested target profile — never the first `img[src*=profile-displayphoto]` on the page (authenticated sessions contaminate nav/sidebar/reaction images with the logged-in viewer's photo).",
    "    - Prefer the platform CDN. A scraped `media.licdn.com` (or `pbs.twimg.com` for X) URL has no request quota and keeps working; spend the effort to get it rather than skipping to the resolver. Verify HTTP 200 before saving. Never guess synthetic redirecting URLs.",
    "    - Resolver is optional and downstream: `https://unavatar.io/...` is capped near 50 requests/day for the whole install. For a LinkedIn person, use `https://unavatar.io/linkedin/user:{slug}` only with the exact slug returned by attestation. If the avatar cannot be confirmed, leave avatar_url blank; missing imagery must never create pressure to guess an identity.",
    snowball.requireApproval
      ? `S5. Approval & Write Back: Candidate roster must be presented in this thread for operator review before bulk committing. Once confirmed, re-attest LinkedIn candidates as needed, stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_user_id,platform_handle,profile_url,avatar_url,identity_evidence_token,notes), and commit with:\n    .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe${attributionFlags}\n    In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO').`
      : `S5. Auto-commit & Graph Edge Linking: Keep Auto-commit enabled. For each accepted candidate, attest first, then stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_user_id,platform_handle,profile_url,avatar_url,identity_evidence_token,notes) and commit with:\n    .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe${attributionFlags}\n    For a LinkedIn-backed run, every row must contain the LinkedIn identity and its valid evidence token; omitting platform/profile fields does not create a bare-contact fallback. The server rejects an unattested candidate before persistence and rejects completion when any accepted cohort contact lacks run-bound evidence. In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO').`,
    "S6. Report Progress: Provide a concise summary table in this thread listing every discovered contact, their proposed company/role, identity attestation outcome, avatar URLs when available, and platform links. Include quarantined failures instead of burying them in prose. End with `N discovered · X committed · Y awaiting verification` and state avatar coverage as `avatars: N/M`, but treat missing avatars as enrichment gaps rather than identity evidence failures.",
    "S7. Teardown & Resource Release:",
    `    - Server-Owned Browser Teardown: Do not close the browser yourself. Call complete_workflow_run (step 10) exactly once when finished. Before that call returns, Signals stops the exact bound session \`${browserSessionName}\` and releases this run's lease, freeing Chromium RAM and CPU without touching unrelated sessions.`,
    "    - Terminate Agent Session: Completion also schedules release of this workflow's linked terminal session after the chat-linked turn finishes — do not send further messages in this thread after completion.",
  ];

  return lines.join("\n");
}
