import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { assertChannelType, normalizeChannelValue, type ChannelType } from "@/lib/db/channel-types";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { getContactDtoById } from "@/lib/db/queries/contact-read-model";
import { contactChannels, contacts } from "@/lib/db/schema";
import type { ContactChannel, ContactWithIdentities, NewContactChannel } from "@/lib/db/types";

export type CreateContactChannelInput = {
  contactId: string;
  channelType: string;
  value: string;
  label?: string | null;
  isPrimary?: boolean;
  isVerified?: boolean;
  contactIdentityId?: string | null;
  scope?: "shared" | "local_only";
  source: string;
  metadata?: Record<string, unknown>;
};

export type UpdateContactChannelInput = {
  value?: string;
  label?: string | null;
  isPrimary?: boolean;
  isVerified?: boolean;
  contactIdentityId?: string | null;
  scope?: "shared" | "local_only";
  metadata?: Record<string, unknown>;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function demoteOtherPrimaries(
  runner: DbRunner,
  contactId: string,
  channelType: string,
  exceptId?: string,
): void {
  const rows = runner
    .select({ id: contactChannels.id })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, contactId),
        eq(contactChannels.channelType, channelType),
        eq(contactChannels.isPrimary, true),
      ),
    )
    .all();

  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    runner
      .update(contactChannels)
      .set({ isPrimary: false, updatedAt: nowUnix() })
      .where(eq(contactChannels.id, row.id))
      .run();
  }
}

export function listContactChannels(contactId: string): ContactChannel[] {
  return db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId))
    .orderBy(desc(contactChannels.isPrimary), desc(contactChannels.createdAt))
    .all();
}

export function getContactChannelById(id: string): ContactChannel | undefined {
  return db.select().from(contactChannels).where(eq(contactChannels.id, id)).get();
}

/** Resolve primary channel for a type — explicit flag, else verified then newest (ADR-092-6). */
export function resolvePrimaryChannel(
  contactId: string,
  channelType: ChannelType,
): ContactChannel | undefined {
  const rows = db
    .select()
    .from(contactChannels)
    .where(
      and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, channelType)),
    )
    .orderBy(desc(contactChannels.isPrimary), desc(contactChannels.isVerified), desc(contactChannels.createdAt))
    .all();

  const explicit = rows.find((row) => row.isPrimary);
  if (explicit) return explicit;
  const verified = rows.find((row) => row.isVerified);
  if (verified) return verified;
  return rows[0];
}

export function createContactChannel(input: CreateContactChannelInput): ContactChannel {
  const channelType = assertChannelType(input.channelType);
  const valueNormalized = normalizeChannelValue(channelType, input.value);
  const contact = db.select().from(contacts).where(eq(contacts.id, input.contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${input.contactId}`);
  }

  const id = nanoid();
  const now = nowUnix();
  const isPrimary = input.isPrimary ?? false;

  db.transaction((tx) => {
    if (isPrimary) {
      demoteOtherPrimaries(tx, input.contactId, channelType);
    }
    tx.insert(contactChannels)
      .values({
        id,
        contactId: input.contactId,
        channelType,
        value: input.value.trim(),
        valueNormalized,
        label: input.label ?? null,
        isPrimary,
        isVerified: input.isVerified ?? false,
        contactIdentityId: input.contactIdentityId ?? null,
        scope: input.scope ?? "shared",
        source: input.source,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      } satisfies Omit<NewContactChannel, "id"> & { id: string })
      .run();
  });

  recalcContactEnrichment(input.contactId);
  return getContactChannelById(id)!;
}

export function updateContactChannel(
  id: string,
  input: UpdateContactChannelInput,
): ContactChannel | undefined {
  const existing = getContactChannelById(id);
  if (!existing) return undefined;

  const channelType = assertChannelType(existing.channelType);
  const updates: Partial<NewContactChannel> = { updatedAt: nowUnix() };

  if (input.value !== undefined) {
    updates.value = input.value.trim();
    updates.valueNormalized = normalizeChannelValue(channelType, input.value);
  }
  if (input.label !== undefined) updates.label = input.label;
  if (input.isVerified !== undefined) updates.isVerified = input.isVerified;
  if (input.contactIdentityId !== undefined) {
    updates.contactIdentityId = input.contactIdentityId;
  }
  if (input.scope !== undefined) updates.scope = input.scope;
  if (input.metadata !== undefined) updates.metadata = JSON.stringify(input.metadata);

  db.transaction((tx) => {
    if (input.isPrimary === true) {
      demoteOtherPrimaries(tx, existing.contactId, channelType, id);
      updates.isPrimary = true;
    } else if (input.isPrimary === false) {
      updates.isPrimary = false;
    }

    tx.update(contactChannels).set(updates).where(eq(contactChannels.id, id)).run();
  });

  recalcContactEnrichment(existing.contactId);
  return getContactChannelById(id);
}

export function deleteContactChannel(id: string): boolean {
  const existing = getContactChannelById(id);
  if (!existing) return false;
  db.delete(contactChannels).where(eq(contactChannels.id, id)).run();
  recalcContactEnrichment(existing.contactId);
  return true;
}

/** Dedup lookup by normalized channel value — excludes archived contacts. */
export function findContactByChannel(
  channelType: string,
  rawValue: string,
): ContactWithIdentities | undefined {
  const type = assertChannelType(channelType);
  const valueNormalized = normalizeChannelValue(type, rawValue);

  const row = db
    .select({ contactId: contactChannels.contactId })
    .from(contactChannels)
    .innerJoin(contacts, eq(contactChannels.contactId, contacts.id))
    .where(
      and(
        eq(contactChannels.channelType, type),
        eq(contactChannels.valueNormalized, valueNormalized),
        sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`,
      ),
    )
    .orderBy(desc(contactChannels.isVerified), desc(contactChannels.createdAt))
    .get();

  if (!row) return undefined;
  return getContactDtoById(row.contactId);
}

/** List channels matching a normalized value (diagnostics / importer use). */
export function listChannelsByNormalizedValue(
  channelType: string,
  rawValue: string,
): ContactChannel[] {
  const type = assertChannelType(channelType);
  const valueNormalized = normalizeChannelValue(type, rawValue);
  return db
    .select()
    .from(contactChannels)
    .where(
      and(eq(contactChannels.channelType, type), eq(contactChannels.valueNormalized, valueNormalized)),
    )
    .orderBy(desc(contactChannels.isVerified), desc(contactChannels.createdAt))
    .all();
}
