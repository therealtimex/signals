import type { ArppPersonDocument } from "@/lib/arpp/types";
import type { ContactWithIdentities } from "@/lib/db/types";
import {
  buildContactWebResearchQuery,
  buildContactWebResearchRefinedQuery,
  buildGoogleSearchUrl,
} from "@/lib/contacts/web-research-query";
import type { ContactWebResearchPreparedTarget } from "@/lib/workflows/contact-web-research-target";

export const CONTACT_WEB_RESEARCH_CONFIG_KEY = "contactWebResearch";
export const CONTACT_WEB_RESEARCH_CONFIG_VERSION = 1;
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
>;

export type ContactWebResearchBriefContext = {
  contact: ContactWebResearchBriefContact;
  arppMissing: string[];
  researchTarget: ContactWebResearchPreparedTarget;
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
  if (contact.profileUrl?.trim()) return contact.profileUrl.trim();
  const primary = contact.identities.find((identity) => identity.isPrimary && identity.isActive);
  const fallback = contact.identities.find((identity) => identity.isActive);
  return primary?.platformUrl?.trim() || fallback?.platformUrl?.trim() || null;
}

export function buildContactWebResearchBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
  context: ContactWebResearchBriefContext;
}): string {
  const { contact } = input.context;
  const { researchTarget } = input.context;
  const query = buildContactWebResearchQuery(contact);
  const refinedQuery = buildContactWebResearchRefinedQuery(contact.name, contact.company);
  const googleUrl = buildGoogleSearchUrl(query);
  const refinedGoogleUrl = buildGoogleSearchUrl(refinedQuery);
  const directProfileUrl = resolveContactWebResearchDirectProfileUrl(contact);

  return [
    "## Contact web research execution contract",
    `Contact ID: ${contact.id}`,
    `Enrichment score: ${contact.enrichmentScore}`,
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
    "### Identity-first shortcut",
    directProfileUrl
      ? `Open this existing verified profile in the attached ${researchTarget.sessionName} session via agent-browser before Google: ${directProfileUrl}`
      : "No direct profile URL is linked; begin with hop 0a.",
    "If a direct fetch fails or identity remains unlinked, continue to hop 0a.",
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
    `Refined query: \`${refinedQuery}\``,
    `Refined URL: ${refinedGoogleUrl}`,
    "If no candidate clears 60, or close profile candidates still look like different people, run this one refined search and re-triage.",
    "If ambiguity remains, do not call upsert_contact_identity. Complete with ambiguous=true, partial=true, and unresolvedFields including sameAs.",
    "",
    "### Hop policy and evidence",
    "- Max 2 Google searches, 3 page visits after SERP, 2 registrable domains, and about 90 seconds wall clock.",
    "- Prefer one LinkedIn or X profile visit. Use a company /about or /team page only when employment remains empty.",
    "- Write only facts visible on pages you visited. Never overwrite existing non-empty contact fields.",
    "- Stop when a LinkedIn/X identity is linked, bio plus headline/title is filled, ambiguity is declared, or the hop budget is exhausted.",
    "",
    "### Tool sequence",
    "1. get_contact → 2. get_contact_arpp (visibility: internal) → 3. RTX Browser triage → 4. upsert_contact_identity → 5. enrich_contact → 6. link_contact_to_org/get_org_aroo if needed → 7. log_interaction with visited URLs → 8. complete_workflow_run.",
    "Pass complete_workflow_run.result with fieldsUpdated, unresolvedFields, identityLinked, visitedUrls, blockedUrls, serpCandidates (top 5), ambiguous, partial, and message.",
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
