import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { contactChannels } from "@/lib/db/schema";
import { ensureContactChannel } from "@/lib/db/queries/contact-channel-writes";

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

    if (row.phone?.trim()) {
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

  return { emails, phones };
}

export function countEmailChannels(): number {
  return db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.channelType, "email"))
    .all().length;
}

export function countPhoneChannels(): number {
  return db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.channelType, "phone"))
    .all().length;
}
