import { eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contentPosts, engagements, interactions } from "@/lib/db/schema";

const SOURCE = "backfill:engagements";

function mapEngagementTypeToInteractionType(engagementType: string): string {
  if (engagementType === "connection_request") return "intro";
  if (engagementType === "retweet") return "share";
  if (engagementType === "reaction") return "like";
  return engagementType;
}

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

    const existing = db
      .select({ id: interactions.id })
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    let contentItemId: string | null = null;
    if (engagement.contentPostId) {
      const post = db
        .select({ contentItemId: contentPosts.contentItemId })
        .from(contentPosts)
        .where(eq(contentPosts.id, engagement.contentPostId))
        .get();
      contentItemId = post?.contentItemId ?? null;
    }

    db.insert(interactions)
      .values({
        id: nanoid(),
        contactId: engagement.contactId,
        orgId: null,
        interactionType: mapEngagementTypeToInteractionType(engagement.engagementType),
        direction: engagement.direction,
        summary: engagement.content,
        isMeaningful: false,
        occurredAt: engagement.createdAt,
        scope: "shared",
        source: SOURCE,
        engagementId: engagement.id,
        contentItemId,
        metadata: engagement.platformData ?? "{}",
      })
      .run();

    inserted++;
  }

  return { inserted, skipped };
}
