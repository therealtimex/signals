import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { columnExists } from "@/lib/db/migration-utils";
import { liftIdentityStatsFromPlatformData } from "@/lib/db/identity-stats";
import { contactIdentities, contacts } from "@/lib/db/schema";

const SOURCE = "backfill:contacts-profile";

type ProfileScalarRow = {
  id: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
};

function readProfileScalarRows(): ProfileScalarRow[] {
  try {
    return sqlite
      .prepare(
        `SELECT id, headline, bio, location, website
         FROM contacts
         WHERE headline IS NOT NULL
            OR bio IS NOT NULL
            OR location IS NOT NULL
            OR website IS NOT NULL`,
      )
      .all() as ProfileScalarRow[];
  } catch {
    return [];
  }
}

function pickPrimaryIdentity(contactId: string) {
  const identities = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all();
  return (
    identities.find((identity) => identity.isPrimary) ??
    [...identities].sort((a, b) => b.createdAt - a.createdAt)[0]
  );
}

/** Lift profile scalars into identities (gap-fill only) before contact profile column drop. */
export function backfillIdentityProfile(): {
  identitiesUpdated: number;
  linkedinHeadlines: number;
} {
  if (!columnExists(sqlite, "contact_identities", "headline")) {
    return { identitiesUpdated: 0, linkedinHeadlines: 0 };
  }

  let identitiesUpdated = 0;
  let linkedinHeadlines = 0;

  const identityRows = db.select().from(contactIdentities).all();
  for (const identity of identityRows) {
    const lifted = liftIdentityStatsFromPlatformData(identity.platformData, {
      statsUpdatedAt: identity.statsUpdatedAt ?? undefined,
    });
    const linkedinHeadline =
      identity.platform === "linkedin"
        ? (lifted as { headline?: string }).headline ??
          (() => {
            try {
              const parsed = JSON.parse(identity.platformData ?? "{}") as Record<string, unknown>;
              const headline = parsed.headline;
              return typeof headline === "string" && headline.trim() ? headline : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;

    const patch: Record<string, string> = {};
    if (!identity.headline && linkedinHeadline) {
      patch.headline = linkedinHeadline;
      linkedinHeadlines++;
    }
    if (!identity.bio && lifted.bio) patch.bio = lifted.bio;
    if (!identity.location && lifted.location) patch.location = lifted.location;
    if (!identity.websiteUrl && lifted.websiteUrl) patch.websiteUrl = lifted.websiteUrl;

    if (Object.keys(patch).length === 0) continue;

    db.update(contactIdentities)
      .set({
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, identity.id))
      .run();
    identitiesUpdated++;
  }

  for (const row of readProfileScalarRows()) {
    const primary = pickPrimaryIdentity(row.id);
    if (!primary) continue;

    const patch: Record<string, string> = {};
    if (!primary.headline && row.headline?.trim()) patch.headline = row.headline.trim();
    if (!primary.bio && row.bio?.trim()) patch.bio = row.bio.trim();
    if (!primary.location && row.location?.trim()) patch.location = row.location.trim();
    if (!primary.websiteUrl && row.website?.trim()) patch.websiteUrl = row.website.trim();

    if (Object.keys(patch).length === 0) continue;

    db.update(contactIdentities)
      .set({
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, primary.id))
      .run();
    identitiesUpdated++;
  }

  return { identitiesUpdated, linkedinHeadlines };
}

export { SOURCE as IDENTITY_PROFILE_BACKFILL_SOURCE };
