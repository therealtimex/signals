import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { engagements, interactions } from "@/lib/db/schema";

/** Copy parity columns from linked engagements onto interactions. */
export function backfillInteractionReadParity(): { updated: number } {
  const rows = db
    .select({
      interactionId: interactions.id,
      contentPostId: engagements.contentPostId,
      platform: engagements.platform,
      workflowRunId: engagements.workflowRunId,
    })
    .from(interactions)
    .innerJoin(engagements, eq(interactions.engagementId, engagements.id))
    .where(
      and(
        isNotNull(interactions.engagementId),
        isNull(interactions.contentPostId),
      ),
    )
    .all();

  let updated = 0;
  for (const row of rows) {
    db.update(interactions)
      .set({
        contentPostId: row.contentPostId,
        platform: row.platform,
        workflowRunId: row.workflowRunId,
      })
      .where(eq(interactions.id, row.interactionId))
      .run();
    updated++;
  }

  return { updated };
}
