import { eq, and } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { normalizeChannelValue } from "@/lib/db/channel-types";
import { ensureContactChannel } from "@/lib/db/queries/contact-channel-writes";
import { contactChannels } from "@/lib/db/schema";

const SOURCE = "backfill:contacts-scalars";

type ScalarRow = {
  id: string;
  email: string | null;
  phone: string | null;
  verifiedEmail: number | null;
};

function readScalarRows(): ScalarRow[] {
  try {
    return sqlite
      .prepare(
        `SELECT id, email, phone, verified_email AS verifiedEmail
         FROM contacts
         WHERE email IS NOT NULL OR phone IS NOT NULL`,
      )
      .all() as ScalarRow[];
  } catch {
    return [];
  }
}

/** Backfill email/phone scalars into `contact_channels` when legacy columns still exist (idempotent). */
export function backfillChannels(): { emails: number; phones: number } {
  const rows = readScalarRows();
  let emails = 0;
  let phones = 0;

  for (const row of rows) {
    if (row.email?.trim()) {
      const normalized = normalizeChannelValue("email", row.email);
      const exists = db
        .select()
        .from(contactChannels)
        .where(
          and(
            eq(contactChannels.contactId, row.id),
            eq(contactChannels.channelType, "email"),
            eq(contactChannels.valueNormalized, normalized),
          ),
        )
        .get();
      if (!exists) {
        ensureContactChannel({
          contactId: row.id,
          channelType: "email",
          value: row.email,
          isPrimary: true,
          isVerified: row.verifiedEmail === 1,
          source: SOURCE,
        });
        emails++;
      }
    }

    if (row.phone?.trim()) {
      const normalized = normalizeChannelValue("phone", row.phone);
      const exists = db
        .select()
        .from(contactChannels)
        .where(
          and(
            eq(contactChannels.contactId, row.id),
            eq(contactChannels.channelType, "phone"),
            eq(contactChannels.valueNormalized, normalized),
          ),
        )
        .get();
      if (!exists) {
        ensureContactChannel({
          contactId: row.id,
          channelType: "phone",
          value: row.phone,
          isPrimary: true,
          source: SOURCE,
        });
        phones++;
      }
    }
  }

  return { emails, phones };
}

export function countContactsWithScalarEmail(): number {
  return readScalarRows().filter((row) => row.email?.trim()).length;
}

export function countEmailChannels(): number {
  return db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.channelType, "email"))
    .all().length;
}

export function countContactsWithScalarPhone(): number {
  return readScalarRows().filter((row) => row.phone?.trim()).length;
}

export function countPhoneChannels(): number {
  return db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.channelType, "phone"))
    .all().length;
}

/** Parity helper: scalar emails missing a matching normalized channel row. */
export function countScalarEmailsMissingChannel(): number {
  let missing = 0;
  for (const row of readScalarRows()) {
    const email = row.email?.trim();
    if (!email) continue;
    const normalized = normalizeChannelValue("email", email);
    const channel = db
      .select()
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.contactId, row.id),
          eq(contactChannels.channelType, "email"),
          eq(contactChannels.valueNormalized, normalized),
        ),
      )
      .get();
    if (!channel) missing++;
  }
  return missing;
}

/** Parity helper: scalar phones missing a matching normalized channel row. */
export function countScalarPhonesMissingChannel(): number {
  let missing = 0;
  for (const row of readScalarRows()) {
    const phone = row.phone?.trim();
    if (!phone) continue;
    const normalized = normalizeChannelValue("phone", phone);
    const channel = db
      .select()
      .from(contactChannels)
      .where(
        and(
          eq(contactChannels.contactId, row.id),
          eq(contactChannels.channelType, "phone"),
          eq(contactChannels.valueNormalized, normalized),
        ),
      )
      .get();
    if (!channel) missing++;
  }
  return missing;
}
