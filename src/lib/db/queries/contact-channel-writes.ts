import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assertChannelType, normalizeChannelValue } from "@/lib/db/channel-types";
import {
  createContactChannel,
  updateContactChannel,
  type CreateContactChannelInput,
} from "@/lib/db/queries/contact-channels";
import { contactChannels } from "@/lib/db/schema";
import type { ContactChannel } from "@/lib/db/types";

export type ChannelInput = {
  channelType: string;
  value: string;
  label?: string | null;
  isPrimary?: boolean;
  isVerified?: boolean;
  contactIdentityId?: string | null;
  scope?: "shared" | "local_only";
};

export function ensureContactChannel(input: CreateContactChannelInput): ContactChannel {
  const channelType = assertChannelType(input.channelType);
  const valueNormalized = normalizeChannelValue(channelType, input.value);

  const existing = db
    .select()
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, input.contactId),
        eq(contactChannels.channelType, channelType),
        eq(contactChannels.valueNormalized, valueNormalized),
      ),
    )
    .get();

  if (!existing) {
    return createContactChannel(input);
  }

  return (
    updateContactChannel(existing.id, {
      label: input.label,
      isPrimary: input.isPrimary,
      isVerified: input.isVerified,
      contactIdentityId: input.contactIdentityId,
      scope: input.scope,
    }) ?? existing
  );
}

export function applyChannelInputs(
  contactId: string,
  channels: ChannelInput[],
  source: string,
): void {
  for (const channel of channels) {
    if (!channel.value?.trim()) continue;
    ensureContactChannel({
      contactId,
      channelType: channel.channelType,
      value: channel.value,
      label: channel.label,
      isPrimary: channel.isPrimary,
      isVerified: channel.isVerified,
      contactIdentityId: channel.contactIdentityId,
      scope: channel.scope,
      source,
    });
  }
}

export function applyLegacyEmailPhone(
  contactId: string,
  fields: {
    email?: string | null;
    phone?: string | null;
    verifiedEmail?: boolean | number | null;
  },
  source: string,
): void {
  const email = fields.email?.trim();
  if (email) {
    ensureContactChannel({
      contactId,
      channelType: "email",
      value: email,
      isPrimary: true,
      isVerified: Boolean(fields.verifiedEmail),
      source,
    });
  }

  const phone = fields.phone?.trim();
  if (phone) {
    ensureContactChannel({
      contactId,
      channelType: "phone",
      value: phone,
      isPrimary: true,
      source,
    });
  }
}
