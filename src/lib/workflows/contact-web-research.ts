import type { ArppPersonDocument } from "@/lib/arpp/types";
import type { ContactWithIdentities } from "@/lib/db/types";
import {
  buildContactWebResearchQuery,
  buildContactWebResearchRefinedQuery,
  buildGoogleSearchUrl,
} from "@/lib/contacts/web-research-query";

export const CONTACT_WEB_RESEARCH_CONFIG_KEY = "contactWebResearch";
export const CONTACT_WEB_RESEARCH_CONFIG_VERSION = 1;
export const CONTACT_WEB_RESEARCH_VISIT_THRESHOLD = 60;

export const CONTACT_WEB_RESEARCH_TOOLS = [
  "get_contact",
  "get_contact_arpp",
  "upsert_contact_identity",
  "enrich_contact",
  "link_contact_to_org",
  "get_org_aroo",
  "log_interaction",
  "complete_workflow_run",
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
    "### Identity-first shortcut",
    directProfileUrl
      ? `Open this existing verified profile before Google: ${directProfileUrl}`
      : "No direct profile URL is linked; begin with hop 0a.",
    "If a direct fetch fails or identity remains unlinked, continue to hop 0a.",
    "",
    "### Hop 0a — search",
    `Query: \`${query}\``,
    `URL: ${googleUrl}`,
    "Open this in RealTimeX Browser. Do not use Signals in-process Serper or Tavily APIs.",
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
    "Pass complete_workflow_run.result with fieldsUpdated, unresolvedFields, identityLinked, visitedUrls, serpCandidates (top 5), ambiguous, partial, and message.",
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
