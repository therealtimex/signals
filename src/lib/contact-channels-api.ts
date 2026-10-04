import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { CHANNEL_TYPES, normalizeChannelValue, type ChannelType } from "@/lib/db/channel-types";
import {
  createContactChannel,
  deleteContactChannel,
  getContactChannelById,
  updateContactChannel,
  type UpdateContactChannelInput,
} from "@/lib/db/queries/contact-channels";
import { contactChannels } from "@/lib/db/schema";
import type { ContactChannel } from "@/lib/db/types";

/**
 * Per-row channel writes for the contact detail tab (#534, ADR-534-2).
 *
 * Separate from `channelInputSchema` in agent-tools on purpose: that schema is
 * the agent contract and feeds `openapi/agent-tools.json`.
 */
export const CONTACT_CHANNELS_API_SOURCE = "api:contact_channels";

const labelSchema = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable()
  .optional();

const valueSchema = z.string().trim().min(1, "Channel value is required");

export const contactChannelCreateSchema = z.object({
  channelType: z.enum(CHANNEL_TYPES),
  value: valueSchema,
  label: labelSchema,
  isPrimary: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

export const contactChannelPatchSchema = z.object({
  value: valueSchema.optional(),
  label: labelSchema,
  isPrimary: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

export type ContactChannelCreateInput = z.infer<typeof contactChannelCreateSchema>;
export type ContactChannelPatchInput = z.infer<typeof contactChannelPatchSchema>;

export const CHANNEL_TYPE_IMMUTABLE_MESSAGE = "Channel type cannot change";

export class ChannelDuplicateError extends Error {
  readonly code = "CHANNEL_DUPLICATE";

  constructor(readonly channelId: string | null) {
    super("This contact already has that channel");
  }
}

export class ChannelValueError extends Error {}

export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

function normalizeOrThrow(channelType: ChannelType, value: string): string {
  const normalized = normalizeChannelValue(channelType, value);
  // "abc" as a phone normalizes to "", which would collide with the next junk value.
  if (!normalized || normalized === "+") {
    throw new ChannelValueError(`Channel value is not a valid ${channelType}`);
  }
  return normalized;
}

function findChannelId(
  contactId: string,
  channelType: ChannelType,
  valueNormalized: string,
): string | null {
  return (
    db
      .select({ id: contactChannels.id })
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.contactId, contactId),
          eq(contactChannels.channelType, channelType),
          eq(contactChannels.valueNormalized, valueNormalized),
        ),
      )
      .get()?.id ?? null
  );
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function manualVerification(): { method: "manual"; at: number } {
  return { method: "manual", at: Math.floor(Date.now() / 1000) };
}

/** The channel when it exists and belongs to `contactId`; a foreign row reads as missing. */
export function getOwnedContactChannel(
  contactId: string,
  channelId: string,
): ContactChannel | undefined {
  const channel = getContactChannelById(channelId);
  return channel?.contactId === contactId ? channel : undefined;
}

export function createChannelForContact(
  contactId: string,
  input: ContactChannelCreateInput,
): ContactChannel {
  const valueNormalized = normalizeOrThrow(input.channelType, input.value);
  const existingId = findChannelId(contactId, input.channelType, valueNormalized);
  if (existingId) throw new ChannelDuplicateError(existingId);

  try {
    return createContactChannel({
      contactId,
      channelType: input.channelType,
      value: input.value,
      label: input.label ?? null,
      isPrimary: input.isPrimary,
      isVerified: input.isVerified,
      source: CONTACT_CHANNELS_API_SOURCE,
      metadata: input.isVerified ? { verification: manualVerification() } : {},
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ChannelDuplicateError(findChannelId(contactId, input.channelType, valueNormalized));
    }
    throw error;
  }
}

/**
 * Returns undefined when the channel does not exist on this contact.
 *
 * Verification provenance (ADR-534-4) is stamped only when the flag turns on,
 * so re-saving a row that `enrich:email_pattern` verified keeps its origin;
 * turning it off removes the stamp.
 */
export function updateChannelForContact(
  contactId: string,
  channelId: string,
  input: ContactChannelPatchInput,
): ContactChannel | undefined {
  const existing = getOwnedContactChannel(contactId, channelId);
  if (!existing) return undefined;
  const channelType = existing.channelType as ChannelType;

  const updates: UpdateContactChannelInput = {};
  let valueNormalized: string | null = null;
  if (input.value !== undefined) {
    valueNormalized = normalizeOrThrow(channelType, input.value);
    const clashId = findChannelId(contactId, channelType, valueNormalized);
    if (clashId && clashId !== channelId) throw new ChannelDuplicateError(clashId);
    updates.value = input.value;
  }
  if (input.label !== undefined) updates.label = input.label;
  if (input.isPrimary !== undefined) updates.isPrimary = input.isPrimary;
  if (input.isVerified !== undefined) {
    updates.isVerified = input.isVerified;
    const metadata = parseMetadata(existing.metadata);
    if (input.isVerified && !existing.isVerified) {
      updates.metadata = { ...metadata, verification: manualVerification() };
    } else if (!input.isVerified && "verification" in metadata) {
      const { verification: _removed, ...rest } = metadata;
      updates.metadata = rest;
    }
  }

  try {
    return updateContactChannel(channelId, updates);
  } catch (error) {
    if (isUniqueConstraintError(error) && valueNormalized) {
      throw new ChannelDuplicateError(findChannelId(contactId, channelType, valueNormalized));
    }
    throw error;
  }
}

export function deleteChannelForContact(contactId: string, channelId: string): boolean {
  if (!getOwnedContactChannel(contactId, channelId)) return false;
  return deleteContactChannel(channelId);
}
