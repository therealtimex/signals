import { sqlite } from "@/lib/db/client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";

type PrimaryRow = {
  rowId: number;
  id: string;
  contactId: string;
  channelType: string;
  isVerified: number;
  createdAt: number;
};

/**
 * Restore one `is_primary` per (contact, channel_type) (ADR-092-6, ADR-534-3).
 *
 * The write path enforces the invariant; contact merge did not, so survivors of
 * Gmail Takeout dedupe carry several primary emails. Per group this keeps the
 * newest verified primary, else the lowest rowid (insertion order, which for
 * Takeout rows is Google's first-listed address), and demotes the rest.
 * Idempotent: a second run finds no group and reports zero.
 */
export function repairChannelPrimaries(): { contacts: number; demoted: number } {
  const rows = sqlite
    .prepare(
      `SELECT rowid AS rowId, id, contact_id AS contactId, channel_type AS channelType,
              is_verified AS isVerified, created_at AS createdAt
       FROM contact_channels
       WHERE is_primary = 1
         AND (contact_id, channel_type) IN (
           SELECT contact_id, channel_type FROM contact_channels
           WHERE is_primary = 1
           GROUP BY contact_id, channel_type
           HAVING COUNT(*) > 1
         )
       ORDER BY contact_id, channel_type, rowid`,
    )
    .all() as PrimaryRow[];
  if (rows.length === 0) return { contacts: 0, demoted: 0 };

  const groups = new Map<string, PrimaryRow[]>();
  for (const row of rows) {
    const key = `${row.contactId}\u0000${row.channelType}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const demote: string[] = [];
  const contactIds = new Set<string>();
  for (const group of groups.values()) {
    const keep = pickKeeper(group);
    for (const row of group) {
      if (row.id !== keep.id) demote.push(row.id);
    }
    contactIds.add(group[0].contactId);
  }

  const now = Math.floor(Date.now() / 1000);
  const update = sqlite.prepare(
    "UPDATE contact_channels SET is_primary = 0, updated_at = ? WHERE id = ?",
  );
  sqlite.transaction(() => {
    for (const id of demote) update.run(now, id);
  })();

  // The avatar resolver reads the primary email, so the score follows the keeper.
  for (const contactId of contactIds) recalcContactEnrichment(contactId);

  return { contacts: contactIds.size, demoted: demote.length };
}

function pickKeeper(group: PrimaryRow[]): PrimaryRow {
  const verified = group.filter((row) => row.isVerified === 1);
  if (verified.length > 0) {
    return verified.reduce((best, row) =>
      row.createdAt > best.createdAt || (row.createdAt === best.createdAt && row.rowId > best.rowId)
        ? row
        : best,
    );
  }
  // Rows arrive in rowid order.
  return group[0];
}
