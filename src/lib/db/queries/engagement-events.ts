import { listContentActivitiesByContentPost } from "@/lib/db/queries/content-activities";
import { listInteractionsByContentPost } from "@/lib/db/queries/interactions";

export type EngagementEventRow = {
  id: string;
  engagementId: string | null;
  eventType: string;
  direction: "inbound" | "outbound" | "mutual" | null;
  summary: string | null;
  occurredAt: number;
  source: string;
  contentPostId: string | null;
  platform: string | null;
  workflowRunId: string | null;
  metadata: string | null;
  contactId: string | null;
};

/** Union of relationship interactions and contactless content activities for a post. */
export function listEngagementEventsByContentPost(contentPostId: string): EngagementEventRow[] {
  const interactions = listInteractionsByContentPost(contentPostId).map((row) => ({
    id: row.id,
    engagementId: row.engagementId,
    eventType: row.interactionType,
    direction: row.direction,
    summary: row.summary,
    occurredAt: row.occurredAt,
    source: row.source,
    contentPostId: row.contentPostId,
    platform: row.platform,
    workflowRunId: row.workflowRunId,
    metadata: row.metadata,
    contactId: row.contactId,
  }));

  const activities = listContentActivitiesByContentPost(contentPostId).map((row) => ({
    id: row.id,
    engagementId: row.engagementId,
    eventType: row.activityType,
    direction: row.direction,
    summary: row.summary,
    occurredAt: row.occurredAt,
    source: row.source,
    contentPostId: row.contentPostId,
    platform: row.platform,
    workflowRunId: row.workflowRunId,
    metadata: row.metadata,
    contactId: null,
  }));

  return [...interactions, ...activities].sort((a, b) => b.occurredAt - a.occurredAt);
}
