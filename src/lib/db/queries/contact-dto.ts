import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels } from "@/lib/db/schema";
import type { Contact, ContactChannel, ContactEmployment, ContactIdentity } from "@/lib/db/types";

export type ContactEmploymentDTO = ContactEmployment & { orgName: string };

export type ContactDTO = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  company: string | null;
  title: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  photoUrl: string | null;
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
  email: string | null;
  phone: string | null;
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

export function assembleContactDto(
  contact: Contact,
  identities: ContactIdentity[],
  channels: ContactChannel[],
  employments: ContactEmploymentDTO[],
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

  return {
    ...contact,
    identities,
    channels,
    employments,
    currentEmployment,
    primaryEmail,
    primaryPhone,
    channelCount: channels.length,
    email: primaryEmail,
    phone: primaryPhone,
    company: currentEmployment?.orgName ?? null,
    title: currentEmployment?.title ?? null,
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
