import { classifyArooConformance } from "@/lib/arpp/conformance";
import {
  companySizeToEmployeeRange,
  orgTypeToArooOrganizationType,
} from "@/lib/arpp/company-size";
import { unixToIso8601 } from "@/lib/arpp/time";
import type {
  ArooDomain,
  ArooOrganizationDocument,
  ArooProjectionOptions,
  ArppOrganizationRef,
  ArppProfile,
} from "@/lib/arpp/types";
import type { Org, OrgIdentity } from "@/lib/db/types";

function parseOrgMetadata(metadata: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function orgIri(orgId: string, prefix: string): string {
  return `${prefix}/${orgId}`;
}

function orgUrn(orgId: string): string {
  return `urn:signals:org:${orgId}`;
}

function readRorIdentifier(metadata: Record<string, unknown>): string | null {
  const identifiers = metadata.identifiers;
  if (!identifiers || typeof identifiers !== "object" || Array.isArray(identifiers)) return null;
  const ror = (identifiers as { ror?: unknown }).ror;
  return typeof ror === "string" && ror.trim() ? ror.trim() : null;
}

export function projectOrgIdentityToArppProfile(identity: OrgIdentity): ArppProfile {
  return {
    network: identity.platform,
    url: identity.platformUrl ?? identity.websiteUrl ?? "",
    username: identity.platformHandle,
    verification: {
      method: identity.isVerified ? "platform-badge" : "self",
      status: identity.isVerified ? "challenge-passed" : "claimed",
      checkedAt: identity.lastSyncedAt ? unixToIso8601(identity.lastSyncedAt) : undefined,
    },
  };
}

/** Minimal Organization stub embedded in ARPP experience blocks. */
export function projectOrgRefToArpp(
  org: Org,
  opts?: Pick<ArooProjectionOptions, "baseIriPrefix">,
): ArppOrganizationRef {
  const prefix = opts?.baseIriPrefix ?? "signals:org";
  const metadata = parseOrgMetadata(org.metadata);
  const ror = readRorIdentifier(metadata);
  const sameAs: string[] = [orgIri(org.id, prefix)];
  if (ror) {
    const rorIri = ror.startsWith("https://") ? ror : `https://ror.org/${ror.replace(/^https?:\/\/ror\.org\//, "")}`;
    sameAs.push(rorIri);
  }
  return {
    "@type": "Organization",
    name: org.name,
    url: org.website,
    sameAs,
  };
}

export type ProjectOrgToArooInput = {
  org: Org;
  domains?: ArooDomain[];
  identities?: OrgIdentity[];
};

export function projectOrgToAroo(
  input: ProjectOrgToArooInput,
  opts?: ArooProjectionOptions,
): ArooOrganizationDocument {
  const visibility = opts?.visibility ?? "internal";
  const prefix = opts?.baseIriPrefix ?? "signals:org";
  const { org } = input;
  const metadata = parseOrgMetadata(org.metadata);
  const ror = readRorIdentifier(metadata);
  const domains =
    input.domains ??
    (org.domain
      ? [{ domain: org.domain, kind: "primary" as const, verified: false }]
      : []);
  const profiles: ArppProfile[] = [];
  for (const identity of input.identities ?? []) {
    if (!identity.isActive) continue;
    const profile = projectOrgIdentityToArppProfile(identity);
    if (profile.url) profiles.push(profile);
  }

  const identifiers = [
    {
      scheme: "signals",
      value: org.id,
      iri: orgIri(org.id, prefix),
    },
  ];
  if (ror) {
    const normalized = ror.replace(/^https?:\/\/ror\.org\//, "");
    identifiers.push({
      scheme: "ror",
      value: normalized,
      iri: `https://ror.org/${normalized}`,
    });
  }

  const sameAs = new Set<string>();
  for (const id of identifiers) {
    if (id.scheme !== "signals") sameAs.add(id.iri);
  }
  for (const profile of profiles) {
    if (profile.url) sameAs.add(profile.url);
  }
  if (org.website) sameAs.add(org.website);

  const employeeRange = companySizeToEmployeeRange(org.companySize);
  const locationString = org.location?.trim();
  const location = locationString
    ? { type: "headquarters", addressLocality: locationString }
    : undefined;

  const doc: ArooOrganizationDocument = {
    $schema: "https://aroo.dev/schema/1.0/organization.json",
    "@context": ["https://schema.org", "https://aroo.dev/ns/1.0/context.jsonld"],
    "@type": "Organization",
    "@id": opts?.canonicalOrgIri ?? orgIri(org.id, prefix),
    id: orgUrn(org.id),
    spec: "aroo/1.0",
    meta: {
      version: "1.0.0",
      revision: org.updatedAt,
      generatedAt: new Date().toISOString(),
      lastUpdated: unixToIso8601(org.updatedAt),
      visibility,
      ...(opts?.canonicalUrl ? { canonicalUrl: opts.canonicalUrl } : {}),
    },
    identity: {
      name: org.name,
      description: org.description,
      url: org.website,
      industry: org.industry,
      organizationType: orgTypeToArooOrganizationType(org.orgType),
      ...(org.avatarUrl ? { logo: { "@type": "ImageObject", url: org.avatarUrl } } : {}),
      ...(employeeRange ? { numberOfEmployees: employeeRange } : {}),
      ...(location ? { location } : {}),
    },
    identifiers,
    sameAs: [...sameAs],
    domains,
    profiles,
    signals: {
      orgId: org.id,
      enrichmentScore: org.enrichmentScore,
      conformance: "O0",
      ...(visibility === "internal"
        ? { accountStage: org.accountStage, ownerContactId: org.ownerContactId }
        : {}),
    },
  };

  doc.signals.conformance = classifyArooConformance(doc);
  return doc;
}
