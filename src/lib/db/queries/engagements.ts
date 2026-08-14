import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { engagements } from "@/lib/db/schema";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";
import { listEngagementEventsByContentPost } from "@/lib/db/queries/engagement-events";
import type { Engagement } from "@/lib/db/types";

type NewEngagementData = Omit<Engagement, "id" | "createdAt">;

/**
 * Sync-provenance write path for platform engagements.
 * Product reads use the engagement-event union — see `listEngagementEventsByContentPost`.
 */
export function createEngagement(data: NewEngagementData): Engagement {
  return db.transaction((tx) => {
    const id = nanoid();
    tx.insert(engagements)
      .values({ ...data, id })
      .run();
    const engagement = tx.select().from(engagements).where(eq(engagements.id, id)).get()!;
    syncInteractionFromEngagement(engagement, undefined, tx);
    return engagement;
  });
}

/** List engagement events for a content post (interactions ∪ content_activities). */
export function listEngagementsByContentPost(contentPostId: string): Engagement[] {
  return listEngagementEventsByContentPost(contentPostId).map(eventToEngagementView);
}

function eventToEngagementView(
  event: ReturnType<typeof listEngagementEventsByContentPost>[number],
): Engagement {
  return {
    id: event.engagementId ?? event.id,
    contactId: event.contactId,
    platformAccountId: null,
    engagementType: mapEventTypeToEngagementType(event.eventType) as Engagement["engagementType"],
    direction: event.direction === "mutual" ? "inbound" : (event.direction ?? "outbound"),
    content: event.summary,
    templateId: null,
    workflowRunId: event.workflowRunId,
    contentPostId: event.contentPostId,
    platform: event.platform as Engagement["platform"],
    platformEngagementId: null,
    threadId: null,
    source: event.source,
    platformData: event.metadata,
    createdAt: event.occurredAt,
  };
}

function mapEventTypeToEngagementType(eventType: string): string {
  if (eventType === "intro") return "connection_request";
  if (eventType === "share") return "retweet";
  return eventType;
}

/** Look up an engagement by its platform-specific ID (dedup check). */
export function getEngagementByPlatformId(platformEngagementId: string): Engagement | undefined {
  return db
    .select()
    .from(engagements)
    .where(eq(engagements.platformEngagementId, platformEngagementId))
    .get();
}
