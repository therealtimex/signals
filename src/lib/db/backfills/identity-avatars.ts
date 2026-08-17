import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { contactIdentities, contacts } from "@/lib/db/schema";

const SOURCE = "backfill:contacts-avatar";

type AvatarScalarRow = {
  id: string;
  avatarUrl: string | null;
  photoUrl: string | null;
  metadata: string | null;
};

function readAvatarScalarRows(): AvatarScalarRow[] {
  try {
    return sqlite
      .prepare(
        `SELECT id, avatar_url AS avatarUrl, photo_url AS photoUrl, metadata
         FROM contacts
         WHERE avatar_url IS NOT NULL OR photo_url IS NOT NULL`,
      )
      .all() as AvatarScalarRow[];
  } catch {
    return [];
  }
}

function pickScalarAvatar(row: AvatarScalarRow): string | null {
  return row.photoUrl?.trim() || row.avatarUrl?.trim() || null;
}

/** Copy legacy contact avatar scalars onto primary identities before column drop. */
export function backfillIdentityAvatars(): {
  identitiesUpdated: number;
  legacyMetadata: number;
} {
  const rows = readAvatarScalarRows();
  let identitiesUpdated = 0;
  let legacyMetadata = 0;

  for (const row of rows) {
    const avatarUrl = pickScalarAvatar(row);
    if (!avatarUrl) continue;

    const identities = db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, row.id))
      .all();

    const primary =
      identities.find((identity) => identity.isPrimary) ??
      [...identities].sort((a, b) => b.createdAt - a.createdAt)[0];

    if (primary) {
      if (primary.avatarUrl) continue;
      db.update(contactIdentities)
        .set({
          avatarUrl,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(contactIdentities.id, primary.id))
        .run();
      identitiesUpdated++;
      continue;
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    if (metadata.legacyAvatarUrl === avatarUrl) continue;

    metadata.legacyAvatarUrl = avatarUrl;
    metadata.legacyAvatarSource = SOURCE;
    db.update(contacts)
      .set({
        metadata: JSON.stringify(metadata),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contacts.id, row.id))
      .run();
    legacyMetadata++;
  }

  return { identitiesUpdated, legacyMetadata };
}
