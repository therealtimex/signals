/**
 * "Network Snowball" — an event-driven network expansion workflow executed in the Terminal Agent lane.
 *
 * It starts from a high-signal seed entity or announcement (funding round, product launch, or executive hire),
 * ingests that seed organization and qualifying author/founder as Hop 0 graph anchors, then rolls outward
 * along causal relationship edges to discover first- and second-degree high-value nodes (investors, angels,
 * co-founders, and technical advocates), filters out bots, extracts profile avatars, and links them into
 * the Signals relationship graph.
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
import { readEventTraversalPolicy } from "@/lib/workflows/event-sources/policy";
import type {
  EventParticipantAccessConfig,
  EventTraversalPolicy,
} from "@/lib/workflows/event-sources/types";
import { sanitizeExternalUrl } from "@/lib/workflows/event-sources/urls";
import type { PublicEventSourceResult } from "@/lib/workflows/event-sources/service";

export const NETWORK_SNOWBALL_TEMPLATE_NAME = "Network Snowball";

/** Marker key in template config. */
export const NETWORK_SNOWBALL_CONFIG_KEY = "networkSnowball";

export const NETWORK_SNOWBALL_CONFIG_VERSION = 1;

export const NETWORK_SNOWBALL_TOOLS = [
  "query_orgs",
  "get_org",
  "create_org",
  "upsert_org_identity",
  "query_contacts",
  "get_contact",
  "attest_snowball_linkedin_identity",
  "list_snowball_candidates",
  "link_contact_to_org",
  "upsert_edge",
  "complete_workflow_run",
] as const;

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
  eventTraversal: EventTraversalPolicy;
  participantAccess: EventParticipantAccessConfig;
  followOnActions?: FollowOnActionType[];
  followOnAction?: FollowOnActionType;
  cascadePolicy?: "immediate" | "supervised";
}

function readParticipantAccess(value: unknown): EventParticipantAccessConfig {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    enabled: record.enabled === true,
    browserSessionName:
      typeof record.browserSessionName === "string"
        ? record.browserSessionName.trim().slice(0, 120)
        : "",
  };
}

/** Sanitize untrusted launch/template config before it can be persisted or logged. */
export function sanitizeNetworkSnowballConfigRecord(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...config };
  if (typeof next.seedValue === "string") {
    next.seedValue = sanitizeExternalUrl(next.seedValue);
  }
  next.eventTraversal = readEventTraversalPolicy(next.eventTraversal);
  next.participantAccess = readParticipantAccess(next.participantAccess);
  for (const key of ["tk", "token", "inviteToken", "accessToken", "authorization", "cookie"]) {
    delete next[key];
  }
  return next;
}

export function sanitizeNetworkSnowballSerializedConfig(config: string): string {
  try {
    const parsed = JSON.parse(config);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return config;
    const record = parsed as Record<string, unknown>;
    return isNetworkSnowballTemplateConfig(record)
      ? JSON.stringify(sanitizeNetworkSnowballConfigRecord(record))
      : config;
  } catch {
    return config;
  }
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

  const sanitized = sanitizeNetworkSnowballConfigRecord(config);
  return {
    seedType,
    seedValue: typeof sanitized.seedValue === "string" ? sanitized.seedValue.trim() : "",
    focus,
    maxContacts: clampNetworkSnowballSlider("maxContacts", config.maxContacts),
    maxHops: clampNetworkSnowballSlider("maxHops", config.maxHops),
    targetPlatform,
    autoLinkGraphEdges: typeof config.autoLinkGraphEdges === "boolean" ? config.autoLinkGraphEdges : true,
    requireApproval: typeof config.requireApproval === "boolean" ? config.requireApproval : false,
    eventTraversal: readEventTraversalPolicy(sanitized.eventTraversal),
    participantAccess: readParticipantAccess(sanitized.participantAccess),
    followOnActions: cascade.followOnActions,
    followOnAction: cascade.followOnActions[0],
    cascadePolicy: cascade.cascadePolicy,
  };
}

export function buildNetworkSnowballRunConfig(
  config: NetworkSnowballConfig,
): Record<string, unknown> {
  const followOnActions = config.followOnActions ?? (config.followOnAction ? [config.followOnAction] : []);
  return sanitizeNetworkSnowballConfigRecord({
    [NETWORK_SNOWBALL_CONFIG_KEY]: { version: NETWORK_SNOWBALL_CONFIG_VERSION },
    seedType: config.seedType,
    seedValue: config.seedValue,
    focus: config.focus,
    maxContacts: clampNetworkSnowballSlider("maxContacts", config.maxContacts),
    maxHops: clampNetworkSnowballSlider("maxHops", config.maxHops),
    targetPlatform: config.targetPlatform,
    autoLinkGraphEdges: config.autoLinkGraphEdges,
    requireApproval: config.requireApproval,
    eventTraversal: readEventTraversalPolicy(config.eventTraversal),
    participantAccess: readParticipantAccess(config.participantAccess),
    [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
      followOnActions,
      cascadePolicy: config.cascadePolicy ?? "immediate",
    }),
  });
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
    eventTraversal: readEventTraversalPolicy({}),
    participantAccess: { enabled: false, browserSessionName: "" },
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
  publicEventSource?: PublicEventSourceResult | null;
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
  const configuredOrgId = typeof input.config.orgId === "string" ? input.config.orgId.trim() : "";
  const hop0OrgReuse = configuredOrgId
    ? `If seedType is org_id, reuse config.orgId \`${configuredOrgId}\` as hop0OrgId rather than creating a duplicate company.`
    : "If seedType is org_id, reuse config.orgId when present as hop0OrgId rather than creating a duplicate company.";
  const graphLinkingInstruction = snowball.autoLinkGraphEdges
    ? "    After contacts.csv import, link Hop 1 (and Hop 2) people to hop0OrgId. Use `link_contact_to_org` for employment (founders, executives, operators). Do not write `works_at` through `upsert_edge`. Use `upsert_edge` for non-employment causal edges (`investor_in`, `advisor_of`, `board_member`) with srcType=contact, dstType=org, dstId=hop0OrgId, and source=\"agent:network_snowball\"."
    : "    autoLinkGraphEdges is false: ingest Hop 0 and later-hop contacts/orgs but do not write graph edges or employment links.";
  const browserTeardownInstruction =
    snowball.participantAccess.enabled &&
    snowball.participantAccess.browserSessionName.trim() === browserTarget?.sessionName
      ? `    - Server-Owned Browser Teardown: Call complete_workflow_run (step 10) exactly once when finished. Signals releases this run's lease but leaves the user-selected borrowed session \`${browserSessionName}\` running.`
      : `    - Server-Owned Browser Teardown: Do not close the browser yourself. Call complete_workflow_run (step 10) exactly once when finished. Before that call returns, Signals stops the exact bound session \`${browserSessionName}\` and releases this run's lease, freeing Chromium RAM and CPU without touching unrelated sessions.`;
  const publicEventContext = input.publicEventSource?.events.length
    ? input.publicEventSource.events
        .map((event) => {
          const roles = event.parties.map((party) => `${party.role}:${party.name}`).join(", ") || "none";
          return `    - ${event.title} (${event.canonicalUrl}); starts=${event.startsAt ?? "unknown"}; location=${event.location ?? "unknown"}; going=${event.audience.goingCount ?? "unknown"}; roles=${roles}`;
        })
        .join("\n")
    : "    - No server-extracted public Luma event record is available.";
  const seedInspectionInstruction = input.publicEventSource
    ? `S1. Inspect Seed Signal: Signals already fetched and persisted the public Luma event source before dispatch. Treat this server-computed public context as authoritative; do not replace it in complete_workflow_run.result:\n${publicEventContext}\n    Registered-only guest observations, when enabled, are stored behind an owner-bound report capability and are never available to this terminal agent. Continue profile expansion only from public named hosts, organizers, sponsors, venues, calendars, and related events.`
    : `S1. Inspect Seed Signal: Attach agent-browser over CDP to the already-running server-bound session named \`${browserSessionName}\` only. It was authenticated as ${browserTarget?.platform ?? "<missing-platform>"} identity \`${verifiedBrowserIdentity}\` before dispatch. Do not create, start, stop, delete, or substitute a browser session. Navigate in that session to the seed post URL, profile, or organization and parse the core event context (e.g. funding round amount, launch specs, executive hire, or partnership announcement).`;

  const lines = [
    "Network Snowball execution contract:",
    `S0. Objective: Ingest Hop 0 graph anchors (primary organization and qualifying author/founder) from seed signal ${seedDescriptor}, then roll outward to discover and map up to ${snowball.maxContacts} connected Hop 1/Hop 2 contact(s) focusing on ${focusDescriptions[snowball.focus]} (max outward depth: ${snowball.maxHops} hop(s); Hop 0 is always ingested and does not count against maxContacts).`,
    seedInspectionInstruction,
    "    - Browser privacy boundary: Never read document.cookie, localStorage, sessionStorage, browser profile files, authorization headers, or other credential material. Use visible page content and links only.",
    "    - Workflow boundary: This is a data-plane run. Never inspect or edit the Signals source tree, package files, tests, or runtime implementation. If a workflow tool or identity gate fails, record the failure and finalize the run as partial/failed; do not patch around the gate.",
    "    - Hop 0 Seed Ingestion (required before Hop 1): The seed is a graph anchor, not only a traversal entrypoint. After parsing the event, ingest the featured company and, when they are a real human decision-maker, the post author or featured founder.",
    `      - Primary Organization: Extract the featured company name plus website/domain and industry when visible. query_orgs by name and get_org by domain when a domain is visible. If none exists, create_org with name/domain/website/industry and this brief's workflowRunId + templateId. For a server-extracted Luma organizer only, also pass observedRole=organized_by; never use that role for a sponsor, venue, calendar, or merely related organization. On CONFLICT, reuse the returned orgId. ${hop0OrgReuse} Record that id as hop0OrgId for later linking.`,
    "      - Primary Contact: If the post author or featured subject is a real human decision-maker (founder, executive, or key ecosystem voice), ingest them as the Hop 0 root contact through the same attestation + contacts.csv path as later hops, with notes like 'role: Founder of Acme (Hop 0 seed)'. If seedType is contact_id, get_contact that id and reuse it as Hop 0. Skip Hop 0 contact creation when the author is an automated news aggregator (PR Newswire, *bot, *daily, *digest, newswire, press-release feeds); still ingest the announced organization.",
    `S2. Discover Connected Nodes: Traverse 1st-degree relational edges from the Hop 0 seed entity:`,
    `    - Backers / Investors: Extract tagged partner handles, mentioned VC funds, and congratulatory angels in replies.`,
    `    - Founding Team: Extract co-founders, CTO, and core team members mentioned or linked in the entity bio.`,
    "S3. Anti-Hallucination & Bot Filter Gate:",
    "    - Anti-Hallucination Rule: Never guess or synthesize vanity profile URLs (e.g. guessing https://linkedin.com/in/<name> from a person's name). Only attach a profile URL or handle if it was explicitly extracted from the page links/DOM or verified via direct search. If unverified, leave profile_url blank rather than mapping to a wrong individual.",
    linkedInGateInstruction,
    `    - snowballScopeToken: "${identityScopeToken}". Copy it exactly into each attestation call; it is bound to workflow run ${input.workflowRunId}. Never put this scope token in contacts.csv.`,
    "    - Use only the `platformUserId`, `platformHandle`, and `platformUrl` returned by attestation. Put its `identityEvidenceToken` in that candidate's `identity_evidence_token` CSV field (or the direct write's `identityEvidenceToken`). Keep the corroborated company/title unchanged through write-back; for a direct identity upsert, pass them as `candidateCompany` / `candidateTitle`. A same-name candidate with different context, or any rejected or expired candidate, must not be committed. Signals automatically saves every failed attestation as an `identity_unverified` quarantined person/company candidate; do not create a bare contact as a fallback. Use `list_snowball_candidates` to review or re-attempt those candidates later.",
    "    - Bot/Clone Filter: Apply the 'Engage for visibility, skip for contacts' rule. Discard automated news bots, clone mirror accounts, and impersonal aggregators (*bot, *daily, *digest) from contacts.csv. The same rule applies to the Hop 0 seed author: skip that contact, still ingest the announced organization.",
    "S4. Avatar Enrichment (downstream of identity attestation): For LinkedIn, use the `avatarUrl` returned by `attest_snowball_linkedin_identity`. Signals extracts it server-side from the attested top card (`.pv-top-card-profile-picture__image` / `main [data-view-name=\"profile-card\"]` / `[componentkey^=\"topcard-\"]`) and rejects navbar/session-viewer photos (`shrink_100_100`, `scale_100_100`, `shrink_50_50`, `.global-nav`). Never scrape the first `img[src*=profile-displayphoto]` on the page.",
    "    - Prefer the platform CDN. A scraped `media.licdn.com` (or `pbs.twimg.com` for X) URL has no request quota and keeps working; spend the effort to get it rather than skipping to the resolver. Verify HTTP 200 before saving. Never guess synthetic redirecting URLs.",
    "    - Resolver is optional and downstream: `https://unavatar.io/...` is capped near 50 requests/day for the whole install. For a LinkedIn person, use `https://unavatar.io/linkedin/user:{slug}` only with the exact slug returned by attestation. If attestation did not return an avatar, leave avatar_url blank; missing imagery must never create pressure to guess an identity.",
    snowball.requireApproval
      ? `S5. Approval & Write Back: Candidate roster must be presented in this thread for operator review before bulk committing. Once confirmed, re-attest LinkedIn candidates as needed, stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_user_id,platform_handle,profile_url,avatar_url,identity_evidence_token,notes), and commit with:\n    .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe${attributionFlags}\n    In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO'). Include the Hop 0 author in the same CSV when they were ingested.\n${graphLinkingInstruction}`
      : `S5. Auto-commit & Graph Edge Linking: Keep Auto-commit enabled. For each accepted candidate, attest first, then stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_user_id,platform_handle,profile_url,avatar_url,identity_evidence_token,notes) and commit with:\n    .claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe${attributionFlags}\n    For a LinkedIn-backed run, every row must contain the LinkedIn identity and its valid evidence token; omitting platform/profile fields does not create a bare-contact fallback. The server rejects an unattested candidate before persistence and rejects completion when any accepted cohort contact lacks run-bound evidence. In the notes field, explicitly record the causal relationship (e.g., 'role: Lead Investor in Acme Seed round' or 'role: Co-Founder & CTO'). Include the Hop 0 author in the same CSV when they were ingested.\n${graphLinkingInstruction}`,
    "S6. Report Progress: Provide a concise summary table in this thread listing Hop 0 (org id plus author or 'org-only, author skipped as aggregator') and every discovered Hop 1/Hop 2 contact, their proposed company/role, identity attestation outcome, avatar URLs when available, and platform links. Include quarantined failures instead of burying them in prose. End with `N discovered · X committed · Y awaiting verification` and state avatar coverage as `avatars: N/M`, but treat missing avatars as enrichment gaps rather than identity evidence failures.",
    "S7. Teardown & Resource Release:",
    browserTeardownInstruction,
    "    - Terminate Agent Session: Completion also schedules release of this workflow's linked terminal session after the chat-linked turn finishes — do not send further messages in this thread after completion.",
  ];

  return lines.join("\n");
}
