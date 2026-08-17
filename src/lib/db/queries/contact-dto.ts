import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels, mediaAttachments } from "@/lib/db/schema";
import type { Contact, ContactChannel, ContactEmployment, ContactIdentity } from "@/lib/db/types";
import { resolveContactAvatar } from "@/lib/db/queries/resolve-contact-avatar";
import {
  resolveContactProfile,
  type ContactProfile,
} from "@/lib/db/queries/resolve-contact-profile";

export type ContactEmploymentDTO = ContactEmployment & { orgName: string };

export type ContactDTO = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  enrichmentScore: number;
  tags: string | null;
  funnelStage: Contact["funnelStage"];
  score: number;
  metadata: string | null;
  lastInteractionAt: number | null;
  isSelf: boolean;
  createdAt: number;
  updatedAt: number;
  identities: ContactIdentity[];
  channels: ContactChannel[];
  employments: ContactEmploymentDTO[];
  currentEmployment: { orgId: string; orgName: string; title: string | null } | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  channelCount: number;
  resolvedAvatarUrl: string | null;
  profile: ContactProfile;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  avatarUrl: string | null;
  photoUrl: string | null;
  profileUrl: string | null;
  headline: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
};

function pickPrimaryChannel(
  channels: ContactChannel[],
  channelType: string,
): ContactChannel | undefined {
  const typed = channels.filter((c) => c.channelType === channelType);
  if (typed.length === 0) return undefined;
  const explicit = typed.find((c) => c.isPrimary);
  if (explicit) return explicit;
  const verified = typed.find((c) => c.isVerified);
  if (verified) return verified;
  return typed.sort((a, b) => b.createdAt - a.createdAt)[0];
}

function resolveCurrentFromEmployments(
  employments: ContactEmploymentDTO[],
): ContactEmploymentDTO | undefined {
  const current = employments.filter((employment) => employment.isCurrent);
  if (current.length === 0) return undefined;

  return [...current].sort((a, b) => {
    const aStart = a.startedAt ?? -1;
    const bStart = b.startedAt ?? -1;
    if (bStart !== aStart) return bStart - aStart;
    return b.createdAt - a.createdAt;
  })[0];
}

function resolvePrimaryIdentityPlatformUrl(identities: ContactIdentity[]): string | null {
  const primary =
    identities.find((identity) => identity.isPrimary) ??
    [...identities].sort((a, b) => {
      const syncA = a.lastSyncedAt ?? a.createdAt;
      const syncB = b.lastSyncedAt ?? b.createdAt;
      return syncB - syncA;
    })[0];
  return primary?.platformUrl ?? null;
}

export function assembleContactDto(
  contact: Contact,
  identities: ContactIdentity[],
  channels: ContactChannel[],
  employments: ContactEmploymentDTO[],
  avatarUploadAssetId?: string | null,
): ContactDTO {
  const primaryEmailChannel = pickPrimaryChannel(channels, "email");
  const primaryPhoneChannel = pickPrimaryChannel(channels, "phone");
  const primaryEmail = primaryEmailChannel?.value ?? null;
  const primaryPhone = primaryPhoneChannel?.value ?? null;
  const currentEmploymentRow = resolveCurrentFromEmployments(employments);
  const currentEmployment = currentEmploymentRow
    ? {
        orgId: currentEmploymentRow.orgId,
        orgName: currentEmploymentRow.orgName,
        title: currentEmploymentRow.title,
      }
    : null;

  const resolvedAvatarUrl = resolveContactAvatar({
    avatarUploadAssetId,
    identities,
    primaryEmail,
  });
  const profile = resolveContactProfile({ identities });
  const profileUrl = resolvePrimaryIdentityPlatformUrl(identities);

  return {
    id: contact.id,
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    enrichmentScore: contact.enrichmentScore,
    tags: contact.tags,
    funnelStage: contact.funnelStage,
    score: contact.score,
    metadata: contact.metadata,
    lastInteractionAt: contact.lastInteractionAt,
    isSelf: contact.isSelf,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    identities,
    channels,
    employments,
    currentEmployment,
    primaryEmail,
    primaryPhone,
    channelCount: channels.length,
    resolvedAvatarUrl,
    profile,
    email: primaryEmail,
    phone: primaryPhone,
    company: currentEmployment?.orgName ?? null,
    title: currentEmployment?.title ?? null,
    avatarUrl: resolvedAvatarUrl,
    photoUrl: resolvedAvatarUrl,
    profileUrl,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
  };
}

export { pickPrimaryChannel as pickPrimaryChannelForDto };

export function resolveContactPrimaryEmail(contactId: string): string | null {
  return resolvePrimaryChannelValue(contactId, "email");
}

export function resolveContactPrimaryPhone(contactId: string): string | null {
  return resolvePrimaryChannelValue(contactId, "phone");
}

export function resolveContactPrimaryEmailVerified(contactId: string): boolean {
  const channel = loadPrimaryChannel(contactId, "email");
  return channel?.isVerified ?? false;
}

export function loadContactAvatarUploadAssetId(contactId: string): string | null {
  const row = db
    .select({ mediaAssetId: mediaAttachments.mediaAssetId })
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.parentType, "contact"),
        eq(mediaAttachments.parentId, contactId),
        eq(mediaAttachments.role, "avatar"),
      ),
    )
    .orderBy(desc(mediaAttachments.updatedAt))
    .get();
  return row?.mediaAssetId ?? null;
}

function loadPrimaryChannel(contactId: string, channelType: string) {
  const rows = db
    .select()
    .from(contactChannels)
    .where(
      and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, channelType)),
    )
    .orderBy(desc(contactChannels.isPrimary), desc(contactChannels.isVerified), desc(contactChannels.createdAt))
    .all();
  return pickPrimaryChannel(rows, channelType);
}

function resolvePrimaryChannelValue(contactId: string, channelType: string): string | null {
  return loadPrimaryChannel(contactId, channelType)?.value ?? null;
}
