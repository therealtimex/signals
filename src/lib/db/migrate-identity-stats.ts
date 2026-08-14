import { eq } from "drizzle-orm";
import { db } from "./client";
import { contactIdentities } from "./schema";
import { liftIdentityStatsFromPlatformData } from "./identity-stats";

/**
 * One-time / startup backfill: lift known stat keys from `platform_data` JSON
 * into typed `contact_identities` columns. Idempotent — only fills empty columns.
 */
export function migrateIdentityStats(): { migrated: number } {
  const identities = db.select().from(contactIdentities).all();
  let migrated = 0;

  for (const identity of identities) {
    const lifted = liftIdentityStatsFromPlatformData(identity.platformData, {
      statsUpdatedAt: identity.lastSyncedAt ?? undefined,
    });
    if (Object.keys(lifted).length === 0) continue;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(lifted)) {
      const current = identity[key as keyof typeof identity];
      if (current === null || current === undefined) {
        patch[key] = value;
      }
    }

    if (Object.keys(patch).length === 0) continue;

    db.update(contactIdentities)
      .set({
        ...patch,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, identity.id))
      .run();
    migrated++;
  }

  return { migrated };
}
