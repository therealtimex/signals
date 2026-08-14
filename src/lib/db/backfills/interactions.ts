import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { engagements, interactions } from "@/lib/db/schema";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";

const SOURCE = "backfill:engagements";

/** Copy `engagements` rows into `interactions` (1:1 via `engagement_id`). */
export function backfillInteractions(): { inserted: number; skipped: number } {
  const rows = db
    .select()
    .from(engagements)
    .where(isNotNull(engagements.contactId))
    .all();

  let inserted = 0;
  let skipped = 0;

  for (const engagement of rows) {
    if (!engagement.contactId) {
      skipped++;
      continue;
    }

    const before = db
      .select({ id: interactions.id })
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    syncInteractionFromEngagement(engagement, { source: SOURCE });

    if (before) {
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}
