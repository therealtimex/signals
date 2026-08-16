import type { Contact, ContactChannel, ContactIdentity } from "@/lib/db/types";
import { resolvePrimaryChannel } from "@/lib/db/queries/contact-channels";

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
  const primaryEmailChannel = pickPrimaryChannel(channels, "email");
  const primaryPhoneChannel = pickPrimaryChannel(channels, "phone");
  const primaryEmail = primaryEmailChannel?.value ?? null;
  const primaryPhone = primaryPhoneChannel?.value ?? null;

  return {
    ...contact,
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
  return resolvePrimaryChannel(contactId, "email")?.value ?? null;
}

export function resolveContactPrimaryPhone(contactId: string): string | null {
  return resolvePrimaryChannel(contactId, "phone")?.value ?? null;
}

export function resolveContactPrimaryEmailVerified(contactId: string): boolean {
  return resolvePrimaryChannel(contactId, "email")?.isVerified ?? false;
}
