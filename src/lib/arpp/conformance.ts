import type {
  ArppConformanceLevel,
  ArppPersonDocument,
  ArooConformanceLevel,
  ArooOrganizationDocument,
} from "@/lib/arpp/types";

const GROUNDED_IDENTIFIER_SCHEMES = new Set(["orcid", "wikidata", "did"]);

export function classifyArppConformance(doc: ArppPersonDocument): ArppConformanceLevel {
  const hasEnvelope =
    doc["@id"] &&
    doc.identity?.fullName &&
    doc.spec === "arpp/1.1";
  const hasSameAs = doc.sameAs.length >= 1;
  if (!hasEnvelope || !hasSameAs) return "L0";

  const hasExperienceOrWorks = doc.experience.length >= 1 || doc.works.length >= 1;
  const hasCompetencies = doc.competencies.length >= 1;
  if (!hasExperienceOrWorks || !hasCompetencies) return "L0";

  const hasGroundedId = doc.identifiers.some((id) => GROUNDED_IDENTIFIER_SCHEMES.has(id.scheme));
  const competenciesWithConcept = doc.competencies.filter(
    (c) => typeof (c as { concept?: { "@id"?: string } }).concept?.["@id"] === "string",
  );
  const conceptRatio =
    doc.competencies.length === 0
      ? 0
      : competenciesWithConcept.length / doc.competencies.length;
  if (!hasGroundedId || conceptRatio < 0.5) return "L1";

  const hasProof = Boolean((doc.meta as { signature?: unknown }).signature);
  const hasVc = doc.credentials.some(
    (c) => typeof (c as { verifiableCredential?: unknown }).verifiableCredential !== "undefined",
  );
  if (!hasProof && !hasVc) return "L2";

  return "L3";
}

export function classifyArooConformance(doc: ArooOrganizationDocument): ArooConformanceLevel {
  const hasEnvelope = doc["@id"] && doc.identity?.name && doc.spec === "aroo/1.0";
  const hasPrimaryDomain = doc.domains.some((d) => d.kind === "primary");
  const hasProfiles = doc.profiles.length >= 1;
  if (!hasEnvelope || (!hasPrimaryDomain && !hasProfiles)) return "O0";

  const hasDescription = Boolean(doc.identity.description?.trim());
  const hasIndustryOrSize =
    Boolean(doc.identity.industry?.trim()) || Boolean(doc.identity.numberOfEmployees);
  if (!hasDescription || !hasIndustryOrSize) return "O0";

  const hasGroundedId = doc.identifiers.some((id) =>
    ["ror", "wikidata", "lei"].includes(id.scheme),
  );
  if (!hasGroundedId) return "O1";

  const primaryVerified = doc.domains.some((d) => d.kind === "primary" && d.verified);
  const hasProof = Boolean((doc.meta as { signature?: unknown }).signature);
  if (!primaryVerified && !hasProof) return "O2";

  return "O3";
}
