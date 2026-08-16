import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assertChannelType, normalizeChannelValue } from "@/lib/db/channel-types";
import {
  createContactChannel,
  deleteContactChannel,
  getContactChannelById,
  listContactChannels,
  resolvePrimaryChannel,
  updateContactChannel,
  type CreateContactChannelInput,
} from "@/lib/db/queries/contact-channels";
import { contactChannels } from "@/lib/db/schema";
import type { ContactChannel } from "@/lib/db/types";

export class ChannelWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelWriteError";
  }
}

export type ChannelInput = {
  id?: string;
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

  const updates: Parameters<typeof updateContactChannel>[1] = {};
  if (input.label !== undefined) updates.label = input.label;
  if (input.isPrimary !== undefined) updates.isPrimary = input.isPrimary;
  if (input.isVerified !== undefined) updates.isVerified = input.isVerified;
  if (input.contactIdentityId !== undefined) {
    updates.contactIdentityId = input.contactIdentityId;
  }
  if (input.scope !== undefined) updates.scope = input.scope;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  return updateContactChannel(existing.id, updates) ?? existing;
}

function updateChannelInPlace(contactId: string, channel: ChannelInput): void {
  if (!channel.id) {
    throw new ChannelWriteError("Channel id is required for in-place update");
  }

  const existing = getContactChannelById(channel.id);
  if (!existing) {
    throw new ChannelWriteError(`Channel not found: ${channel.id}`);
  }
  if (existing.contactId !== contactId) {
    throw new ChannelWriteError(`Channel ${channel.id} does not belong to contact ${contactId}`);
  }
  if (existing.channelType !== channel.channelType) {
    throw new ChannelWriteError("Channel type cannot change");
  }

  updateContactChannel(channel.id, {
    value: channel.value,
    label: channel.label,
    isPrimary: channel.isPrimary,
    isVerified: channel.isVerified,
  });
}

export function applyChannelInputs(
  contactId: string,
  channels: ChannelInput[],
  source: string,
): void {
  for (const channel of channels) {
    if (!channel.value?.trim()) continue;

    if (channel.id) {
      updateChannelInPlace(contactId, channel);
      continue;
    }

    const payload: CreateContactChannelInput = {
      contactId,
      channelType: channel.channelType,
      value: channel.value,
      label: channel.label,
      isPrimary: channel.isPrimary,
      contactIdentityId: channel.contactIdentityId,
      scope: channel.scope,
      source,
    };
    if (channel.isVerified !== undefined) {
      payload.isVerified = channel.isVerified;
    }
    ensureContactChannel(payload);
  }
}

/** Replace the contact's channel set with the provided inputs (full sync). */
export function syncChannelInputs(
  contactId: string,
  channels: ChannelInput[],
  source: string,
): void {
  const incomingIds = new Set(
    channels.map((channel) => channel.id).filter((id): id is string => Boolean(id)),
  );
  const existing = listContactChannels(contactId);

  for (const id of incomingIds) {
    const row = getContactChannelById(id);
    if (!row) {
      throw new ChannelWriteError(`Channel not found: ${id}`);
    }
    if (row.contactId !== contactId) {
      throw new ChannelWriteError(`Channel ${id} does not belong to contact ${contactId}`);
    }
  }

  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      deleteContactChannel(row.id);
    }
  }

  applyChannelInputs(contactId, channels.filter((channel) => channel.value?.trim()), source);
}

function removePrimaryChannel(contactId: string, channelType: string): void {
  const primary = resolvePrimaryChannel(contactId, channelType as "email" | "phone");
  if (primary) {
    deleteContactChannel(primary.id);
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
  if (fields.email !== undefined) {
    const email = fields.email?.trim() ?? "";
    if (email) {
      const payload: CreateContactChannelInput = {
        contactId,
        channelType: "email",
        value: email,
        isPrimary: true,
        source,
      };
      if (fields.verifiedEmail !== undefined) {
        payload.isVerified = Boolean(fields.verifiedEmail);
      }
      ensureContactChannel(payload);
    } else {
      removePrimaryChannel(contactId, "email");
    }
  } else if (fields.verifiedEmail !== undefined) {
    const primary = resolvePrimaryChannel(contactId, "email");
    if (primary) {
      updateContactChannel(primary.id, { isVerified: Boolean(fields.verifiedEmail) });
    }
  }

  if (fields.phone !== undefined) {
    const phone = fields.phone?.trim() ?? "";
    if (phone) {
      ensureContactChannel({
        contactId,
        channelType: "phone",
        value: phone,
        isPrimary: true,
        source,
      });
    } else {
      removePrimaryChannel(contactId, "phone");
    }
  }
}
