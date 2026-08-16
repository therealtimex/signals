import type { Contact, ContactChannel, ContactIdentity } from "@/lib/db/types";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels } from "@/lib/db/schema";

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
  primaryEmail: string | null;
  primaryPhone: string | null;
  channelCount: number;
  email: string | null;
  phone: string | null;
};

export function assembleContactDto(
  contact: Contact,
  identities: ContactIdentity[],
  channels: ContactChannel[],
): ContactDTO {
  const {
    platform: _platform,
    platformUserId: _platformUserId,
    verifiedEmail: _verifiedEmail,
    email: _legacyEmail,
    phone: _legacyPhone,
    ...contactRest
  } = contact;
  const primaryEmailChannel = pickPrimaryChannel(channels, "email");
  const primaryPhoneChannel = pickPrimaryChannel(channels, "phone");
  const primaryEmail = primaryEmailChannel?.value ?? null;
  const primaryPhone = primaryPhoneChannel?.value ?? null;

  return {
    ...contactRest,
    identities,
    channels,
    primaryEmail,
    primaryPhone,
    channelCount: channels.length,
    email: primaryEmail,
    phone: primaryPhone,
  };
}

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
