import type { ArppPersonDocument, ArooOrganizationDocument } from "@/lib/arpp/types";

export type AgentProfile = ArppPersonDocument | ArooOrganizationDocument;

function isPersonProfile(profile: AgentProfile): profile is ArppPersonDocument {
  return profile["@type"] === "Person";
}

export function agentProfileMissingFields(profile: AgentProfile): string[] {
  if (isPersonProfile(profile)) {
    const missing: string[] = [];
    if (profile.sameAs.length === 0) missing.push("Linked public profile");
    if (profile.experience.length === 0 && profile.works.length === 0) {
      missing.push("Experience or authored work");
    }
    if (profile.competencies.length === 0) missing.push("At least one competency");
    if (!profile.identifiers.some((id) => ["orcid", "wikidata", "did"].includes(id.scheme))) {
      missing.push("Grounded identifier (ORCID, Wikidata, or DID)");
    }
    if (profile.signals.conformance !== "L3") {
      missing.push("Signed proof or verifiable credential");
    }
    return missing;
  }

  const missing: string[] = [];
  if (!profile.domains.some((domain) => domain.kind === "primary") && profile.profiles.length === 0) {
    missing.push("Primary domain or organization profile");
  }
  if (!profile.identity.description?.trim()) missing.push("Description");
  if (!profile.identity.industry?.trim() && !profile.identity.numberOfEmployees) {
    missing.push("Industry or company size");
  }
  if (!profile.identifiers.some((id) => ["ror", "wikidata", "lei"].includes(id.scheme))) {
    missing.push("Grounded identifier (ROR, Wikidata, or LEI)");
  }
  if (!profile.domains.some((domain) => domain.kind === "primary" && domain.verified)) {
    missing.push("Verified primary domain or signed proof");
  }
  return missing;
}
