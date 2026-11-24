import type { ArppPersonDocument } from "@/lib/arpp/types";
import { identityProfileHref } from "@/lib/contact-identity-handle";
import { corporateEmailDomain } from "@/lib/contacts/corporate-domain";
import { IDENTITY_PROVENANCE_KIND_ENUM } from "@/lib/identity-provenance";
import type { ContactWithIdentities } from "@/lib/db/types";
import {
  buildContactWebResearchQuery,
  buildContactWebResearchRefinedQuery,
  buildGoogleSearchUrl,
} from "@/lib/contacts/web-research-query";
import type { ContactWebResearchPreparedTarget } from "@/lib/workflows/contact-web-research-target";

export const CONTACT_WEB_RESEARCH_CONFIG_KEY = "contactWebResearch";
export const CONTACT_WEB_RESEARCH_CONFIG_VERSION = 2;
export const CONTACT_WEB_RESEARCH_VISIT_THRESHOLD = 60;
export const CONTACT_WEB_RESEARCH_THREAD_NAME = "Contact Enrich Profile";

export const CONTACT_WEB_RESEARCH_TOOLS = [
  "get_contact",
  "get_contact_arpp",
  "upsert_contact_identity",
  "enrich_contact",
  "link_contact_to_org",
  "get_org_aroo",
  "log_interaction",
  "complete_workflow_run",
  "get_platform_target",
  "prepare_platform_target",
  "release_platform_target",
] as const;

export type ContactWebResearchBriefContact = Pick<
  ContactWithIdentities,
  | "id"
  | "name"
  | "company"
  | "title"
  | "headline"
  | "location"
  | "website"
  | "profileUrl"
  | "enrichmentScore"
  | "identities"
  | "email"
> & {
  /** Other names the contact already goes by; optional so older callers keep compiling. */
  aliases?: string[];
};

/**
 * Which identity-provenance branch the research brief runs (#571), read from the primary
 * identity. `unknown` covers a missing primary identity and every identity stored before
 * provenance existed (provenance null). `unknown` is not `inferred`, but both keep the ordinary
 * same-human check and ambiguity rule.
 */
export const CONTACT_WEB_RESEARCH_IDENTITY_PROVENANCE_USED = [
  ...IDENTITY_PROVENANCE_KIND_ENUM,
  "unknown",
] as const;

export type ContactWebResearchIdentityProvenanceUsed =
  (typeof CONTACT_WEB_RESEARCH_IDENTITY_PROVENANCE_USED)[number];

type BriefIdentity = ContactWebResearchBriefContact["identities"][number];

export type ContactWebResearchPrimaryIdentity = {
  identity: BriefIdentity | null;
  provenanceUsed: ContactWebResearchIdentityProvenanceUsed;
};

export type ContactWebResearchBriefContext = {
  contact: ContactWebResearchBriefContact;
  arppMissing: string[];
  researchTarget: ContactWebResearchPreparedTarget;
};

export type ContactWebResearchKnownProfileCandidate = {
  identityId: string | null;
  platform: string;
  platformUserId: string | null;
  platformHandle: string | null;
  url: string;
  isPrimary: boolean;
  source: "stored" | "derived" | "contact";
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function buildContactWebResearchTemplateConfig(): Record<string, unknown> {
  return {
    [CONTACT_WEB_RESEARCH_CONFIG_KEY]: { version: CONTACT_WEB_RESEARCH_CONFIG_VERSION },
    acceptsContactId: true,
  };
}

export function isContactWebResearchTemplateConfig(
  config: Record<string, unknown>,
): boolean {
  return objectValue(config[CONTACT_WEB_RESEARCH_CONFIG_KEY]) !== null;
}

export type ContactWebResearchCompletionAudit = {
  errors: string[];
  unresolvedFields: string[];
  partial: boolean;
};

export function auditContactWebResearchCompletion(
  config: Record<string, unknown>,
  result: Record<string, unknown>,
): ContactWebResearchCompletionAudit {
  const researchConfig = objectValue(config[CONTACT_WEB_RESEARCH_CONFIG_KEY]);
  const version = typeof researchConfig?.version === "number" ? researchConfig.version : 1;
  if (version < 2) return { errors: [], unresolvedFields: [], partial: false };

  const requiredResultFields = [
    "verifiedProfileUrls",
    "profileSectionsInspected",
    "emailsObserved",
    "experiencesUpserted",
  ];
  const missingResultFields = requiredResultFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(result, field),
  );
  const errors = missingResultFields.length > 0
    ? [`contract_result_missing:${missingResultFields.join(",")}`]
    : [];
  const unresolvedFields = Array.isArray(result.unresolvedFields)
    ? result.unresolvedFields.filter((value): value is string => typeof value === "string")
    : [];
  const verifiedProfileUrls = Array.isArray(result.verifiedProfileUrls)
    ? result.verifiedProfileUrls.filter((value): value is string => typeof value === "string")
    : [];
  const hasVerifiedLinkedIn = verifiedProfileUrls.some((value) => {
    try {
      const url = new URL(value);
      return /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\//i.test(url.pathname);
    } catch {
      return false;
    }
  });
  if (!hasVerifiedLinkedIn) {
    return {
      errors,
      unresolvedFields,
      partial: errors.length > 0 || result.partial === true,
    };
  }

  const inspected = new Set(
    Array.isArray(result.profileSectionsInspected)
      ? result.profileSectionsInspected.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  const normalizedUnresolved = unresolvedFields.map((value) => value.toLowerCase());
  const requiredSections = [
    { key: "linkedin_about", label: "LinkedIn About", unresolvedTerm: "about" },
    {
      key: "linkedin_experience",
      label: "LinkedIn Experience",
      unresolvedTerm: "experience",
    },
  ];
  for (const section of requiredSections) {
    if (inspected.has(section.key)) continue;
    const alreadyUnresolved = normalizedUnresolved.some((value) =>
      value.includes(section.unresolvedTerm),
    );
    if (alreadyUnresolved) {
      errors.push(`profile_section_unresolved:${section.key}`);
      continue;
    }
    unresolvedFields.push(section.label);
    normalizedUnresolved.push(section.label.toLowerCase());
    errors.push(`profile_section_uninspected:${section.key}`);
  }

  return {
    errors,
    unresolvedFields,
    partial: errors.length > 0 || result.partial === true,
  };
}

export function getContactWebResearchArppMissing(profile: ArppPersonDocument): string[] {
  const missing: string[] = [];
  if (profile.sameAs.length === 0) missing.push("sameAs (linked public profile)");
  if (!profile.identity.biography?.trim() && !profile.identity.disambiguatingDescription?.trim()) {
    missing.push("biography or headline");
  }
  if (profile.experience.length === 0) missing.push("experience");
  return missing;
}

export function resolveContactWebResearchDirectProfileUrl(
  contact: ContactWebResearchBriefContact,
): string | null {
  return resolveContactWebResearchKnownProfileCandidates(contact)[0]?.url ?? null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function candidateProfileHref(
  identity: ContactWebResearchBriefContact["identities"][number],
): string | null {
  // identityProfileHref never uses platformUserId, which may be opaque, and rejects values
  // that do not have a valid platform handle/vanity shape.
  const href = identityProfileHref(identity);
  return href && isHttpUrl(href) ? href : null;
}

export function resolveContactWebResearchKnownProfileCandidates(
  contact: ContactWebResearchBriefContact,
): ContactWebResearchKnownProfileCandidate[] {
  const active: Array<{
    identity: ContactWebResearchBriefContact["identities"][number];
    index: number;
  }> = [];
  contact.identities.forEach((identity, index) => {
    if (identity.isActive) active.push({ identity, index });
  });
  active.sort(
    (a, b) =>
      Number(Boolean(b.identity.isPrimary)) - Number(Boolean(a.identity.isPrimary)) ||
      a.index - b.index,
  );
  const seen = new Set<string>();
  const candidates: ContactWebResearchKnownProfileCandidate[] = [];

  for (const { identity } of active) {
    const url = candidateProfileHref(identity);
    if (!url) continue;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      identityId: identity.id,
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      platformHandle: identity.platformHandle,
      url,
      isPrimary: Boolean(identity.isPrimary),
      source: identity.platformUrl?.trim() === url ? "stored" : "derived",
    });
  }

  const contactUrl = contact.profileUrl?.trim() ?? "";
  const contactUrlKey = contactUrl.replace(/\/$/, "").toLowerCase();
  if (isHttpUrl(contactUrl) && !seen.has(contactUrlKey)) {
    candidates.push({
      identityId: null,
      platform: "unknown",
      platformUserId: null,
      platformHandle: null,
      url: contactUrl,
      isPrimary: true,
      source: "contact",
    });
  }

  return candidates;
}

/**
 * The identity whose provenance decides the research branch: the active identity marked
 * primary, otherwise the first active identity; none means `unknown`. Inactive identities are
 * skipped because the brief never sends the agent to them.
 */
export function resolveContactWebResearchPrimaryIdentity(
  contact: Pick<ContactWebResearchBriefContact, "identities">,
): ContactWebResearchPrimaryIdentity {
  const active = contact.identities.filter((identity) => identity.isActive);
  const identity = active.find((candidate) => candidate.isPrimary) ?? active[0] ?? null;
  const kind = identity?.provenanceKind ?? null;
  return { identity, provenanceUsed: kind ?? "unknown" };
}

function isConfirmedProvenance(
  provenanceUsed: ContactWebResearchIdentityProvenanceUsed,
): provenanceUsed is "self_declared" | "agent_verified" {
  return provenanceUsed === "self_declared" || provenanceUsed === "agent_verified";
}

function buildIdentityProvenanceLines(
  contact: ContactWebResearchBriefContact,
  primary: ContactWebResearchPrimaryIdentity,
): string[] {
  const reportLine = `Report result.identityProvenanceUsed: "${primary.provenanceUsed}" and result.aliasesAdded with the names enrich_contact actually added (an empty array when none).`;
  const { identity, provenanceUsed } = primary;
  if (!identity || !isConfirmedProvenance(provenanceUsed)) {
    return [
      `### Primary identity provenance: ${provenanceUsed}`,
      provenanceUsed === "inferred"
        ? "The primary identity was matched from weaker signals. Verify it like every other candidate; the same-human check and the ambiguity rule below apply."
        : "Where the primary identity came from is not recorded. Verify it like every other candidate; the same-human check and the ambiguity rule below apply.",
      reportLine,
    ];
  }

  const url = candidateProfileHref(identity) ?? identity.platformUrl ?? "no profile URL recorded";
  const source = identity.provenanceSourceUrl
    ? `; declared on ${identity.provenanceSourceUrl}`
    : "";
  const knownAliases = contact.aliases?.length
    ? `Known aliases (already stored, do not resend): ${contact.aliases.map((alias) => JSON.stringify(alias)).join(", ")}.`
    : "No aliases are stored yet.";
  return [
    `### Primary identity provenance: ${provenanceUsed}`,
    `Primary identity ID: ${identity.id}; platform: ${identity.platform}; URL: ${url}${source}.`,
    provenanceUsed === "self_declared"
      ? "The person linked this account to a profile they control. It is their own account, which is stronger evidence than any name match."
      : "An agent already verified this account against corroborating evidence. Treat it as confirmed for identity purposes.",
    "- Skip the name-match and same-human check for this identity. Open it and mine it directly: company, title, headline, About, Contact info and Experience, under the mining gate below.",
    `- A visible display name that differs from "${contact.name}" (a nickname, initials, another surname) is not ambiguity. Never complete with ambiguous=true because of it.`,
    '- Record each different display name as an alias, in its own call: enrich_contact { "contactId": "<contact ID>", "aliases": ["<name exactly as shown>"] }. Duplicates are ignored by the server.',
    `  ${knownAliases}`,
    "- When writing this identity back with upsert_contact_identity, use its exact identity ID and omit provenance. Never send provenance kind self_declared; a weaker kind is ignored by the server (provenanceWrite: \"kept_existing\").",
    "- This exception covers only this identity. Every other candidate, known or found by search, still needs the same-human check.",
    reportLine,
  ];
}

/**
 * LinkedIn's own Experience details view for a `/in/<slug>` profile URL (#571 gap 2): the page
 * the profile's "Show all experiences" control opens. Null for anything that is not a LinkedIn
 * member profile.
 */
export function linkedInExperienceDetailsUrl(profileUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(profileUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const slug = /^\/in\/([^/]+)/i.exec(url.pathname)?.[1];
  return slug ? `https://www.linkedin.com/in/${slug}/details/experience/` : null;
}

export function buildContactWebResearchBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
  context: ContactWebResearchBriefContext;
}): string {
  const { contact } = input.context;
  const { researchTarget } = input.context;
  const corporateDomain = corporateEmailDomain(contact.email);
  const query = buildContactWebResearchQuery(contact);
  const refinedQuery = buildContactWebResearchRefinedQuery(contact);
  const googleUrl = buildGoogleSearchUrl(query);
  const refinedGoogleUrl = buildGoogleSearchUrl(refinedQuery);
  const knownProfileCandidates = resolveContactWebResearchKnownProfileCandidates(contact);
  const primaryIdentity = resolveContactWebResearchPrimaryIdentity(contact);
  const experienceDetailsLines = knownProfileCandidates.flatMap((candidate) => {
    const detailsUrl = linkedInExperienceDetailsUrl(candidate.url);
    return detailsUrl ? [`  - ${candidate.url} → ${detailsUrl}`] : [];
  });
  const primaryConfirmed =
    primaryIdentity.identity !== null && isConfirmedProvenance(primaryIdentity.provenanceUsed);
  const knownProfileCandidateLines = knownProfileCandidates.map(
    (candidate, index) =>
      `${index + 1}. Existing identity ID: ${candidate.identityId ?? "not recorded"}; platform: ${candidate.platform}; platform user ID: ${candidate.platformUserId ?? "not recorded"}; handle: ${candidate.platformHandle ?? "not recorded"}; URL (${candidate.source}): ${candidate.url}`,
  );

  return [
    "## Contact web research execution contract",
    `Contact ID: ${contact.id}`,
    `Enrichment score: ${contact.enrichmentScore}`,
    ...(corporateDomain
      ? [
          `Corporate email domain: ${corporateDomain}. A profile whose company website, employer, or email domain matches it is strong matching evidence; a mismatch alone is not disqualifying.`,
        ]
      : []),
    `ARPP gaps to prioritize: ${input.context.arppMissing.join("; ") || "none listed"}`,
    `Signals callback base URL: ${input.signalsBaseUrl}`,
    "",
    "### Authenticated browser session (required — do not research without it)",
    `Target ID: ${researchTarget.targetId} (${researchTarget.platform}, ${researchTarget.source})  Expected handle: ${researchTarget.expectedHandle ?? "not recorded"}  Verified handle: ${researchTarget.verifiedHandle ?? "not recorded"}`,
    `Session name: ${researchTarget.sessionName}   Start URL: ${researchTarget.startUrl}`,
    `Lease ID: ${researchTarget.leaseId}   Lease expires: ${new Date(researchTarget.leaseExpiresAt * 1000).toISOString()} (renew below if needed)`,
    `B1. Discover the already-prepared session port: realtimex-pp-cli list-browser-sessions --agent --compact=false --data-source live --no-cache → exact entry with sessionName "${researchTarget.sessionName}" → remoteDebugPort (or runtime.remoteDebugPort/runtime.port).`,
    "    prepare_platform_target already started and verified this session. If the exact entry is absent, stopped, or has no positive remoteDebugPort, fail closed. Never run create-browser-session, start-browser-session, stop-browser-session, or delete-browser-session; never use another session name.",
    `B2. Attach without launching a browser: agent-browser --session ${researchTarget.sessionName} connect <remoteDebugPort>; then agent-browser --session ${researchTarget.sessionName} tab. Ignore devtools://, /cli-browser/index.html, file:///.../src/cli-browser/index.html, and the target titled "RealTimeX Browser". Select the HTTPS content target whose host matches ${researchTarget.startUrl}/${researchTarget.platform}; if none exists, fail closed rather than attaching elsewhere.`,
    "B3. Navigate ONLY through agent-browser (open <url>) inside this session. Never open URLs through realtimex-pp-cli start-browser-session --url — the session allowlist blocks non-platform origins on that path.",
    `B4. Every hop (Google search, refined search, profile visits, company pages) runs in this same session so its cookies and the ${researchTarget.platform} login are retained.`,
    "B5. If B1–B2 fail, do not research in any other profile. Call complete_workflow_run with status \"failed\" and errors [\"browser_session_unavailable: <detail>\"].",
    `B6. If the lease will expire before you finish, renew: prepare_platform_target { targetId: "${researchTarget.targetId}", intent: "browse", leaseId: "${researchTarget.leaseId}", holder: "contact-web-research:${input.workflowRunId}" }. Do not release the lease yourself; complete_workflow_run releases it.`,
    "",
    "### Auth-state failures (source failures, never evidence)",
    "- LinkedIn /authwall, /login, /checkpoint/*, /uas/login; Google /sorry/* or any reCAPTCHA interstitial; X /i/flow/login or /login; accounts.google.com.",
    "- Do not extract, score, or write anything from such a page. Record the URL in result.blockedUrls.",
    "- URL patterns are the server-verifiable floor. Also inspect the rendered page for a CAPTCHA/reCAPTCHA challenge or sign-in/auth-wall copy; if a challenge is rendered without a URL change, record the current URL in result.blockedUrls.",
    `- On ${researchTarget.platform} itself an auth wall means the verified session was lost: call complete_workflow_run with status "failed" and errors ["auth_state_lost: <url>"].`,
    "- On any other platform record the block, continue with remaining candidates, and set partial=true.",
    "",
    ...buildIdentityProvenanceLines(contact, primaryIdentity),
    "",
    "### Known identities first (required before generic search)",
    knownProfileCandidateLines.length > 0
      ? `Open and verify every candidate below, in order, in the attached ${researchTarget.sessionName} session before Google. A stored or derived URL is a high-confidence seed, not proof that its visible person matches the contact${primaryConfirmed ? ", except the primary identity whose provenance is stated above" : ""}.`
      : "No safe direct profile URL can be derived from the active identities; begin with hop 0a.",
    ...knownProfileCandidateLines,
    "For an existing identity, write verified fields back with upsert_contact_identity using its exact identity ID and contactId. Do not create a second row for the same platform account.",
    "From every matching profile, collect the visible full display name, company, role, website, known handles, and exact outbound social-profile links. Open an exact outbound LinkedIn /in/ link before searching; verify it against the accumulated evidence before upserting it.",
    "For a newly discovered LinkedIn profile, use its exact verified /in/<slug> value as platformUserId and platformHandle and preserve the visited profile URL as platformUrl. Never synthesize a LinkedIn slug from a person's name.",
    "Do not stop merely because an X identity was already stored. When X is known but no active LinkedIn identity is listed, inspect the X profile's outbound links and run the one identity-aware LinkedIn search below before completing.",
    "The authenticated browser owner is transport context only. Never treat the signed-in account, navigation avatar, sidebar identity, or session expected/verified handle as evidence about this contact.",
    "If a known profile cannot be fetched, does not match, or leaves cross-platform identity gaps, continue to hop 0a.",
    "",
    "### Verified LinkedIn profile mining gate (required before completion)",
    "- On every matching LinkedIn /in/ profile, inspect the visible About text, Contact info when available, and the complete visible Experience section (including the same-profile Show all experiences control and its resulting details view). Existing identity or employment rows do not satisfy this gate.",
    `- LinkedIn renders Experience lazily, below the fold, so a snapshot taken at the top of the profile does not show it. Before deciding Experience is missing: scroll it into view (agent-browser --session ${researchTarget.sessionName} scrollintoview "#experience", or scroll down 2000 repeated until the page bottom), wait for it to render (wait 2000), then take a fresh snapshot. If the page stays blank, check document.visibilityState as the agent-browser skill describes.`,
    "- If Experience is still missing, or the Show all experiences control does not render, open the profile's own Experience details view in the same session: https://www.linkedin.com/in/<slug>/details/experience/ with the verified profile's exact slug. Wait for its list, then snapshot. It is the page Show all experiences opens, so it is part of the same profile and does not consume another page visit.",
    ...(experienceDetailsLines.length > 0
      ? ["  Experience details views for the known LinkedIn candidates:", ...experienceDetailsLines]
      : []),
    "- If the details view redirects to an auth wall, login or checkpoint page, that is an auth-state failure under the rules above, not missing data: record the landed auth-wall URL (not the details URL) in blockedUrls and follow the auth_state_lost rule.",
    "- Whenever you open the details view, add its URL to visitedUrls. Keep the /in/<slug>/ profile URL itself in verifiedProfileUrls and as the identity platformUrl; the details URL may be the evidenceUrl for roles read from it.",
    "- Mine every visible Experience entry, not only the current role. Call enrich_contact with employmentObservations containing orgName, title, isCurrent, evidenceUrl, and dates as UTC Unix seconds only when the page shows them precisely enough; omit uncertain dates rather than infer them.",
    "- Deduplicate an existing incomplete role by organization plus title; enrich its missing dates/evidence instead of creating a duplicate. Do not delete employment rows that are absent from the visible page.",
    "- Mine only email addresses explicitly self-published by this person in About or Contact info. Call enrich_contact with observedEmails containing the exact address, the LinkedIn profile evidenceUrl, the visible sentence as evidenceText, and sourcePlatform=linkedin. Never guess or derive an address.",
    "- A self-published email is source-confirmed evidence, not mailbox/deliverability verification. Do not mark it verified and do not call predicted-email verification tools for it.",
    "- If About, Contact info, or Experience is unavailable or collapsed behind an inaccessible control, name that section in unresolvedFields and set partial=true; do not silently treat identityLinked as completion.",
    "- Report the matching LinkedIn URL in verifiedProfileUrls, attempted sections in profileSectionsInspected, and the persisted enrich_contact counts in emailsObserved and experiencesUpserted.",
    "",
    "### Hop 0a — search",
    `Query: \`${query}\``,
    `URL: ${googleUrl}`,
    `Open this in the attached ${researchTarget.sessionName} session via agent-browser. Do not use Signals in-process Serper or Tavily APIs.`,
    "",
    "### Hop 0b — scored SERP triage (required before profile navigation)",
    `- Snapshot the SERP and write workflow-runs/${input.workflowRunId}/serp-candidates.json.`,
    "- Include visible organic results and AI Overview cited URLs as candidates; AI Overview is never a write source until its cited page is opened.",
    "- URL scores: LinkedIn /in/ +100; X/Twitter profile +80; matching company domain +70; Crunchbase person +50; Wikipedia/Wikidata person +40; news/directories -50.",
    "- Text scores: full name in title +30; company in snippet +25; role keyword in snippet +15; different-person evidence -80.",
    `- Visit only candidates with totalScore >= ${CONTACT_WEB_RESEARCH_VISIT_THRESHOLD}; do not use SERP rank as the decision rule.`,
    "- An LLM may rerank title and snippet only when the top two deterministic scores are within 15 points. Do not load pages for reranking.",
    "",
    "### Ambiguity and refined search",
    `Baseline refined query: \`${refinedQuery}\``,
    `Baseline refined URL: ${refinedGoogleUrl}`,
    `If no candidate clears 60, close profile candidates${primaryConfirmed ? " (other than the primary identity)" : ""} still look like different people, or a verified known profile reveals a likely missing LinkedIn identity, run one refined search and re-triage.`,
    "Before opening the refined search, replace the baseline's weak/original name with the strongest full display name verified on a known profile and retain its known handle and company. Prefer `\"<verified full name>\" \"<company>\" linkedin`; if the company is absent, use `\"<verified handle>\" linkedin`. The baseline URL is only a fallback when direct-profile evidence adds nothing.",
    primaryConfirmed
      ? `If ambiguity remains about another candidate, do not call upsert_contact_identity for it. The primary identity (${primaryIdentity.identity?.id}) stays confirmed: still mine it, and set ambiguous=true only if it could not be opened and no other candidate was verified.`
      : "If ambiguity remains, do not call upsert_contact_identity. Complete with ambiguous=true, partial=true, and unresolvedFields including sameAs.",
    "",
    "### Hop policy and evidence",
    "- Max 2 Google searches, 3 page visits after SERP, 2 registrable domains, and about 120 seconds wall clock. Expanding About, Contact info, or Experience on the same verified profile, including opening its /details/experience/ view, does not consume another page visit.",
    "- Visit all listed known identity candidates first. After SERP triage, prefer one additional LinkedIn or X profile visit. Use a company /about or /team page only when employment remains empty.",
    "- Write only facts visible on pages you visited. Never overwrite existing non-empty contact fields.",
    "- Linking an identity or filling bio/headline is not a stop condition while a verified LinkedIn profile still has uninspected required sections. Stop after known-identity and missing-LinkedIn discovery plus the verified-profile mining gate are attempted, ambiguity is declared, or the hop budget is exhausted.",
    "",
    "### Tool sequence",
    "1. get_contact → 2. get_contact_arpp (visibility: internal) → 3. RTX Browser triage → 4. upsert_contact_identity → 5. enrich_contact with scalar gaps plus observedEmails/employmentObservations → 6. link_contact_to_org/get_org_aroo only if still needed → 7. log_interaction with visited URLs → 8. complete_workflow_run.",
    "Pass complete_workflow_run.result with fieldsUpdated, unresolvedFields, identityLinked, verifiedProfileUrls, profileSectionsInspected, emailsObserved, experiencesUpserted, visitedUrls, blockedUrls, serpCandidates (top 5), ambiguous, partial, identityProvenanceUsed, aliasesAdded, and message.",
  ].join("\n");
}

export function resolveContactWebResearchCascadeTarget(
  config: Record<string, unknown>,
  result: Record<string, unknown>,
): string | null {
  if (!isContactWebResearchTemplateConfig(config) || result.identityLinked !== true) return null;
  const contactId = typeof config.contactId === "string" ? config.contactId.trim() : "";
  return contactId || null;
}
