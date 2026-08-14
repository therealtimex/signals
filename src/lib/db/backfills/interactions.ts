import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentActivities, engagements, interactions } from "@/lib/db/schema";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";

const SOURCE = "backfill:engagements";

/** Copy `engagements` rows into `interactions` or `content_activities` via routed sync. */
export function backfillInteractions(): { inserted: number; skipped: number } {
  const rows = db.select().from(engagements).all();

  let inserted = 0;
  let skipped = 0;

  for (const engagement of rows) {
    const beforeInteraction = db
      .select({ id: interactions.id })
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();
    const beforeActivity = db
      .select({ id: contentActivities.id })
      .from(contentActivities)
      .where(eq(contentActivities.engagementId, engagement.id))
      .get();

    syncInteractionFromEngagement(engagement, { source: SOURCE });

    if (beforeInteraction || beforeActivity) {
      skipped++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}
