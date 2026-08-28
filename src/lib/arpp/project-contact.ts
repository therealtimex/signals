import { classifyArppConformance } from "@/lib/arpp/conformance";
import { projectOrgRefToArpp } from "@/lib/arpp/project-org";
import { unixToIso8601, unixToYearMonth } from "@/lib/arpp/time";
import type {
  ArppExperience,
  ArppPersonDocument,
  ArppProfile,
  ArppProjectionOptions,
} from "@/lib/arpp/types";
import type { ContactDTO, ContactEmploymentDTO } from "@/lib/db/queries/contact-dto";
import type { ContactChannel, ContactIdentity, Org } from "@/lib/db/types";

function contactIri(contactId: string, prefix: string): string {
  return `${prefix}/${contactId}#person`;
}

function contactUrn(contactId: string): string {
  return `urn:signals:contact:${contactId}`;
}

function parseEmploymentMetadata(metadata: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isSharedChannel(channel: ContactChannel, visibility: "internal" | "public"): boolean {
  if (visibility === "internal") return true;
  return channel.scope === "shared";
}

function isSharedEmployment(
  employment: ContactEmploymentDTO,
  org: Org | undefined,
  visibility: "internal" | "public",
): boolean {
  if (visibility === "internal") return true;
  if (employment.scope !== "shared") return false;
  return org?.scope === "shared";
}

function projectIdentityToProfile(identity: ContactIdentity): ArppProfile | null {
  const url = identity.platformUrl ?? identity.websiteUrl;
  if (!url) return null;
  return {
    network: identity.platform,
    url,
    username: identity.platformHandle,
    verification: {
      method: identity.isVerified ? "platform-badge" : "self",
      status: identity.isVerified ? "challenge-passed" : "claimed",
      checkedAt: identity.lastSyncedAt ? unixToIso8601(identity.lastSyncedAt) : undefined,
    },
  };
}

function resolvePreferredChannel(
  contact: ContactDTO,
  visibility: "internal" | "public",
): string {
  const email = contact.channels.find(
    (c) => c.channelType === "email" && isSharedChannel(c, visibility) && c.isVerified,
  );
  if (email) return "email";
  if (contact.website) return "web";
  return "not-specified";
}

function buildExperience(
  contact: ContactDTO,
  orgsById: Map<string, Org>,
  visibility: "internal" | "public",
  orgIriPrefix: string,
): ArppExperience[] {
  const experience: ArppExperience[] = [];
  for (const employment of contact.employments) {
    const org = orgsById.get(employment.orgId);
    if (!isSharedEmployment(employment, org, visibility)) continue;

    const meta = parseEmploymentMetadata(employment.metadata);
    const employmentType =
      typeof meta.employmentType === "string" ? meta.employmentType : "other";
    experience.push({
      id: `exp:${employment.id}`,
      role: employment.title,
      employmentType,
      organization: org
        ? projectOrgRefToArpp(org, { baseIriPrefix: orgIriPrefix })
        : {
            "@type": "Organization",
            name: employment.orgName,
          },
      timePeriod: {
        start: unixToYearMonth(employment.startedAt),
        end: employment.isCurrent ? null : unixToYearMonth(employment.endedAt),
        current: employment.isCurrent,
      },
    });
  }
  return experience;
}

function collectSameAs(contact: ContactDTO, profiles: ArppProfile[]): string[] {
  const urls = new Set<string>();
  for (const profile of profiles) {
    if (profile.url) urls.add(profile.url);
  }
  if (contact.website) urls.add(contact.website);
  for (const identity of contact.identities) {
    if (identity.websiteUrl) urls.add(identity.websiteUrl);
  }
  return [...urls];
}

export type ProjectContactToArppInput = {
  contact: ContactDTO;
  orgsById: Map<string, Org>;
};

export function projectContactToArpp(
  input: ProjectContactToArppInput,
  opts?: ArppProjectionOptions,
): ArppPersonDocument {
  const { contact, orgsById } = input;
  const visibility = opts?.visibility ?? "internal";
  const baseIriPrefix = opts?.baseIriPrefix ?? "signals:contact";

  const activeIdentities = contact.identities.filter((identity) => identity.isActive);
  const profiles = activeIdentities
    .map(projectIdentityToProfile)
    .filter((profile): profile is ArppProfile => profile !== null);

  const primaryIdentity =
    activeIdentities.find((identity) => identity.isPrimary) ?? activeIdentities[0];
  const preferredName =
    primaryIdentity?.displayName &&
    primaryIdentity.displayName.trim() &&
    primaryIdentity.displayName !== contact.name
      ? primaryIdentity.displayName
      : null;

  const includeEmail = opts?.includeEmail !== false;
  let email: string | null = null;
  if (includeEmail) {
    if (visibility === "public") {
      email = contact.channels.find(
        (c) => c.channelType === "email" && c.scope === "shared" && c.isVerified,
      )?.value ?? null;
    } else {
      email = contact.primaryEmail;
    }
  }

  const orgIriPrefix = opts?.baseIriPrefix?.replace(/:contact$/, ":org") ?? "signals:org";
  const experience = buildExperience(contact, orgsById, visibility, orgIriPrefix);
  const sameAs = collectSameAs(contact, profiles);

  const doc: ArppPersonDocument = {
    $schema: "https://arpp.dev/schema/1.1/person.json",
    "@context": ["https://schema.org", "https://arpp.dev/ns/1.1/context.jsonld"],
    "@type": "Person",
    "@id": opts?.canonicalPersonIri ?? contactIri(contact.id, baseIriPrefix),
    id: contactUrn(contact.id),
    spec: "arpp/1.1",
    meta: {
      version: "1.1.0",
      revision: contact.updatedAt,
      generatedAt: new Date().toISOString(),
      lastUpdated: unixToIso8601(contact.updatedAt),
      visibility,
      ...(opts?.canonicalUrl ? { canonicalUrl: opts.canonicalUrl } : {}),
      ...(opts?.publisherIri ? { publisher: opts.publisherIri } : {}),
    },
    identity: {
      fullName: contact.name,
      givenName: contact.firstName,
      familyName: contact.lastName,
      preferredName,
      biography: contact.profile.bio,
      disambiguatingDescription: contact.profile.headline,
      jobTitle: contact.currentEmployment?.title ?? contact.title,
      url: contact.website,
      ...(email ? { email } : {}),
      ...(contact.resolvedAvatarUrl
        ? { image: { "@type": "ImageObject", url: contact.resolvedAvatarUrl } }
        : {}),
      contact: {
        preferredChannel: resolvePreferredChannel(contact, visibility),
        url: contact.website,
      },
    },
    identifiers: [
      {
        scheme: "signals",
        value: contact.id,
        iri: `${baseIriPrefix}/${contact.id}`,
      },
      ...activeIdentities.map((identity) => ({
        scheme: identity.platform,
        value: identity.platformUserId,
        iri: identity.platformUrl ?? `${baseIriPrefix}/${contact.id}#${identity.platform}`,
      })),
    ],
    sameAs,
    profiles,
    competencies: [],
    experience,
    education: [],
    credentials: [],
    works: [],
    knowsAbout: [],
    signals: {
      contactId: contact.id,
      enrichmentScore: contact.enrichmentScore,
      conformance: "L0",
    },
  };

  doc.signals.conformance = classifyArppConformance(doc);
  return doc;
}
