import {
  projectContactToArpp,
  resolveCurrentContactEmployment,
  visibleContactEmployments,
} from "@/lib/arpp/project-contact";
import { projectOrgToAroo } from "@/lib/arpp/project-org";
import { AgentToolError } from "@/lib/agent-tools/types";
import { db } from "@/lib/db/client";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import { getContactById, getOwnerContactId } from "@/lib/db/queries/contacts";
import { listOrgIdentitiesByOrg } from "@/lib/db/queries/org-identities";
import { getOrgById } from "@/lib/db/queries/orgs";
import { orgDomains } from "@/lib/db/schema";
import type { Org, OrgDomain, OrgIdentity } from "@/lib/db/types";
import {
  brandRenderedBrandInput,
  brandRenderedIdentityInput,
  brandRenderedVoiceInput,
  type PersonalitySources,
  type RenderedBrandInput,
  type RenderedIdentityInput,
  type RenderedVoiceInput,
} from "@/lib/personality/contracts";
import { readPersonalityStatements } from "@/lib/personality/statements";
import { getRepresentedOrgId } from "@/lib/settings/signals-config";
import type { VoiceProfile } from "@/lib/writing/contracts";
import {
  getActiveVoiceProfileFor,
  getVoiceProfile,
} from "@/lib/writing/voice-profile-store";
import { eq } from "drizzle-orm";

const ARRAY_LIMIT = 50;

function personalityValidationError(message: string, reason: string): AgentToolError {
  return new AgentToolError("VALIDATION_ERROR", message, { reason });
}

function contactOrgs(contact: ContactDTO): Map<string, Org> {
  return new Map(
    contact.employments.flatMap((employment) => {
      const org = getOrgById(employment.orgId);
      return org ? [[org.id, org] as const] : [];
    }),
  );
}

function compareProfiles(
  left: { network: string; url: string },
  right: { network: string; url: string },
): number {
  return compareText(left.network, right.network) || compareText(left.url, right.url);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function toRenderedIdentityInput(
  contact: ContactDTO,
  orgsById: Map<string, Org>,
  selectedOrg: Org | null,
): RenderedIdentityInput {
  const publicArpp = projectContactToArpp(
    { contact, orgsById },
    { visibility: "public", includeEmail: false },
  );
  const publicEmployments = visibleContactEmployments(contact, orgsById, "public");
  const current = resolveCurrentContactEmployment(publicEmployments);
  const currentOrg = current ? orgsById.get(current.orgId) : undefined;
  const activeIdentities = contact.identities.filter((identity) => identity.isActive);
  const profiles = publicArpp.profiles
    .flatMap((profile) => {
      if (!profile.url) return [];
      const identity = activeIdentities.find((candidate) =>
        candidate.platform === profile.network
        && (candidate.platformUrl ?? candidate.websiteUrl) === profile.url);
      return [{
        network: profile.network,
        url: profile.url,
        displayName: identity?.displayName ?? null,
      }];
    })
    .sort(compareProfiles)
    .slice(0, ARRAY_LIMIT);

  return brandRenderedIdentityInput({
    contactId: contact.id,
    name: publicArpp.identity.fullName,
    preferredName: publicArpp.identity.preferredName ?? null,
    headline: publicArpp.identity.disambiguatingDescription ?? null,
    bio: publicArpp.identity.biography ?? null,
    currentRole: current?.title && currentOrg
      ? { title: current.title, orgName: currentOrg.name }
      : null,
    website: publicArpp.identity.url ?? null,
    profiles,
    representedOrgName: selectedOrg?.name ?? null,
  });
}

export function toRenderedBrandInput(
  org: Org,
  domains: OrgDomain[],
  identities: OrgIdentity[],
  selfRelationshipTitle: string | null,
): RenderedBrandInput {
  const projectedDomains = domains.map((domain) => ({
    domain: domain.domain,
    kind: domain.kind,
    verified: domain.mxStatus === "ok",
  }));
  const publicAroo = projectOrgToAroo(
    { org, domains: projectedDomains.length > 0 ? projectedDomains : undefined, identities },
    { visibility: "public" },
  );
  const primaryDomain = projectedDomains
    .filter((domain) => domain.kind === "primary")
    .sort((left, right) => compareText(left.domain, right.domain))[0]
    ?? (org.domain ? { domain: org.domain, kind: "primary" as const, verified: false } : null);
  const profiles = publicAroo.profiles
    .flatMap((profile) => {
      if (!profile.url) return [];
      const identity = identities.find((candidate) =>
        candidate.platform === profile.network
        && (candidate.platformUrl ?? candidate.websiteUrl) === profile.url);
      return [{
        network: profile.network,
        url: profile.url,
        displayName: identity?.displayName ?? null,
      }];
    })
    .sort(compareProfiles)
    .slice(0, ARRAY_LIMIT);

  return brandRenderedBrandInput({
    orgId: org.id,
    name: publicAroo.identity.name,
    description: publicAroo.identity.description ?? null,
    website: publicAroo.identity.url ?? null,
    industry: publicAroo.identity.industry ?? null,
    companySize: org.companySize,
    primaryDomain: primaryDomain
      ? { domain: primaryDomain.domain, verified: primaryDomain.verified }
      : null,
    profiles,
    selfRelationshipTitle,
  });
}

export function toRenderedVoiceInput(profile: VoiceProfile): RenderedVoiceInput {
  const admissible = profile.samples.filter((sample) =>
    sample.approved
    && !sample.excludedReason
    && sample.authorship === "self");
  const admissibleSampleIds = new Set(admissible.map((sample) => sample.id));
  return brandRenderedVoiceInput({
    profile: {
      id: profile.id,
      label: profile.label,
      version: profile.version,
      hash: profile.hash,
    },
    platforms: [...profile.platforms].sort().slice(0, ARRAY_LIMIT),
    sentenceLength: profile.fingerprint.sentenceLength
      ? {
          median: profile.fingerprint.sentenceLength.medianWords,
          range: profile.fingerprint.sentenceLength.range,
        }
      : null,
    openers: profile.fingerprint.openers.slice(0, ARRAY_LIMIT),
    closers: profile.fingerprint.closers.slice(0, ARRAY_LIMIT),
    punctuation: profile.fingerprint.punctuation.slice(0, ARRAY_LIMIT),
    formats: profile.fingerprint.formats.slice(0, ARRAY_LIMIT),
    emoji: profile.fingerprint.emoji === "none" ? [] : [profile.fingerprint.emoji],
    hashtags: profile.fingerprint.hashtags === "none" ? [] : [profile.fingerprint.hashtags],
    vocabulary: {
      keep: profile.fingerprint.vocabulary.keep.slice(0, ARRAY_LIMIT),
      avoid: profile.fingerprint.vocabulary.avoid.slice(0, ARRAY_LIMIT),
    },
    protectedQuirks: profile.fingerprint.protectedQuirks.slice(0, ARRAY_LIMIT),
    taboo: profile.fingerprint.taboo.slice(0, ARRAY_LIMIT),
    signatureLines: profile.signatureLines
      .flatMap((line) => admissibleSampleIds.has(line.sampleId)
        ? [{ id: line.sampleId, text: line.text }]
        : [])
      .sort((left, right) => compareText(left.id, right.id))
      .slice(0, ARRAY_LIMIT),
    exemplars: admissible
      .flatMap((sample) => sample.text.length <= 600
        ? [{ id: sample.id, text: sample.text }]
        : [])
      .sort((left, right) => compareText(left.id, right.id))
      .slice(0, ARRAY_LIMIT),
  });
}

function resolveVoice(selfContactId: string, voiceProfileId?: string): VoiceProfile | null {
  if (!voiceProfileId) return getActiveVoiceProfileFor({ ownerContactId: selfContactId });
  let profile: VoiceProfile;
  try {
    ({ profile } = getVoiceProfile(voiceProfileId));
  } catch {
    throw personalityValidationError(
      "Voice profile is not an approved self-owned profile",
      "voice_not_self_owned",
    );
  }
  if (profile.status !== "approved" || profile.ownerContactId !== selfContactId) {
    throw personalityValidationError(
      "Voice profile is not an approved self-owned profile",
      "voice_not_self_owned",
    );
  }
  return profile;
}

export type LoadedPersonalitySourceBundle = {
  sources: PersonalitySources;
  revisions: { self: number; org?: number };
};

export function loadPersonalitySourceBundle(
  options: { voiceProfileId?: string } = {},
): LoadedPersonalitySourceBundle {
  const selfContactId = getOwnerContactId();
  const self = selfContactId ? getContactById(selfContactId) : undefined;
  if (!self || !self.isSelf) {
    throw new AgentToolError("NOT_FOUND", "Self contact is missing", {
      reason: "self_contact_missing",
    });
  }

  const orgsById = contactOrgs(self);
  const representedOrgId = getRepresentedOrgId();
  const representedOrg = representedOrgId ? getOrgById(representedOrgId) : undefined;
  if (representedOrgId && (!representedOrg || representedOrg.ownerContactId !== self.id)) {
    throw personalityValidationError(
      "Represented organization must be owned by the self contact",
      "org_not_represented",
    );
  }

  let brand: RenderedBrandInput | null = null;
  if (representedOrg) {
    const domains = db
      .select()
      .from(orgDomains)
      .where(eq(orgDomains.orgId, representedOrg.id))
      .all();
    const selfRelationship = resolveCurrentContactEmployment(
      visibleContactEmployments(self, orgsById, "public")
        .filter((employment) => employment.orgId === representedOrg.id),
    );
    brand = toRenderedBrandInput(
      representedOrg,
      domains,
      listOrgIdentitiesByOrg(representedOrg.id),
      selfRelationship?.title ?? null,
    );
  }

  const voice = resolveVoice(self.id, options.voiceProfileId);
  return {
    sources: {
      identity: toRenderedIdentityInput(self, orgsById, representedOrg ?? null),
      brand,
      voice: voice ? toRenderedVoiceInput(voice) : null,
      statements: readPersonalityStatements(),
    },
    revisions: {
      self: self.updatedAt,
      ...(representedOrg ? { org: representedOrg.updatedAt } : {}),
    },
  };
}

export function loadPersonalitySources(
  options: { voiceProfileId?: string } = {},
): PersonalitySources {
  return loadPersonalitySourceBundle(options).sources;
}
