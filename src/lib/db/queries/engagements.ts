import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { engagements } from "@/lib/db/schema";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";
import type { Engagement } from "@/lib/db/types";

type NewEngagementData = Omit<Engagement, "id" | "createdAt">;

/** Record a new engagement action and dual-write to `interactions`. */
export function createEngagement(data: NewEngagementData): Engagement {
  const id = nanoid();
  db.insert(engagements)
    .values({ ...data, id })
    .run();
  const engagement = db.select().from(engagements).where(eq(engagements.id, id)).get()!;
  syncInteractionFromEngagement(engagement);
  return engagement;
}

/** List engagements for a content post. */
export function listEngagementsByContentPost(contentPostId: string): Engagement[] {
  return db
    .select()
    .from(engagements)
    .where(eq(engagements.contentPostId, contentPostId))
    .orderBy(desc(engagements.createdAt))
    .all();
}

/** Look up an engagement by its platform-specific ID (dedup check). */
export function getEngagementByPlatformId(platformEngagementId: string): Engagement | undefined {
  return db
    .select()
    .from(engagements)
    .where(eq(engagements.platformEngagementId, platformEngagementId))
    .get();
}
