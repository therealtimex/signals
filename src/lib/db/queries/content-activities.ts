import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentActivities } from "@/lib/db/schema";
import type { ContentActivity } from "@/lib/db/types";

export function listContentActivitiesByContentPost(contentPostId: string): ContentActivity[] {
  return db
    .select()
    .from(contentActivities)
    .where(eq(contentActivities.contentPostId, contentPostId))
    .orderBy(desc(contentActivities.occurredAt))
    .all();
}

export function getContentActivityByEngagementId(
  engagementId: string,
): ContentActivity | undefined {
  return db
    .select()
    .from(contentActivities)
    .where(eq(contentActivities.engagementId, engagementId))
    .get();
}
