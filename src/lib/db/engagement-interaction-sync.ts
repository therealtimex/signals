import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { contentActivities, contentPosts, interactions } from "@/lib/db/schema";
import type { ContentActivity, Engagement, Interaction } from "@/lib/db/types";
import { touchContactLastInteraction } from "@/lib/db/queries/contact-interaction-projection";
import { resolveEngagementTargetContact } from "@/lib/db/queries/engagement-target-contact";

export function mapEngagementTypeToInteractionType(engagementType: string): string {
  if (engagementType === "connection_request") return "intro";
  if (engagementType === "retweet") return "share";
  if (engagementType === "reaction") return "like";
  return engagementType;
}

export function interactionSourceFromEngagement(engagement: Engagement): string {
  if (engagement.source === "manual" || engagement.source === "agent") return engagement.source;
  if (engagement.source?.startsWith("sync:") || engagement.source?.startsWith("backfill:")) {
    return engagement.source;
  }
  if (engagement.platform) return `sync:${engagement.platform}`;
  return engagement.source ? `sync:${engagement.source}` : "sync:unknown";
}

function resolveContentItemId(engagement: Engagement, runner: DbRunner = db): string | null {
  if (!engagement.contentPostId) return null;
  const post = runner
    .select({ contentItemId: contentPosts.contentItemId })
    .from(contentPosts)
    .where(eq(contentPosts.id, engagement.contentPostId))
    .get();
  return post?.contentItemId ?? null;
}

function resolveContactIdForEngagement(
  engagement: Engagement,
  runner: DbRunner = db,
): string | null {
  if (engagement.contactId) return engagement.contactId;
  if (engagement.contentPostId) {
    return resolveEngagementTargetContact(engagement.contentPostId, runner);
  }
  return null;
}

export type EngagementSyncResult =
  | { kind: "interaction"; row: Interaction }
  | { kind: "activity"; row: ContentActivity };

/**
 * Route an engagement into `interactions` (counterparty known) or
 * `content_activities` (actor-only / anonymous). Idempotent via `engagement_id`.
 */
export function syncInteractionFromEngagement(
  engagement: Engagement,
  opts?: { source?: string },
  runner: DbRunner = db,
): EngagementSyncResult | null {
  const existingInteraction = runner
    .select()
    .from(interactions)
    .where(eq(interactions.engagementId, engagement.id))
    .get();
  if (existingInteraction) {
    touchContactLastInteraction(
      existingInteraction.contactId,
      existingInteraction.occurredAt,
      runner,
    );
    return { kind: "interaction", row: existingInteraction };
  }

  const existingActivity = runner
    .select()
    .from(contentActivities)
    .where(eq(contentActivities.engagementId, engagement.id))
    .get();
  if (existingActivity) {
    return { kind: "activity", row: existingActivity };
  }

  const contactId = resolveContactIdForEngagement(engagement, runner);
  const occurredAt = engagement.createdAt;
  const source = opts?.source ?? interactionSourceFromEngagement(engagement);
  const contentItemId = resolveContentItemId(engagement, runner);
  const eventType = mapEngagementTypeToInteractionType(engagement.engagementType);

  if (contactId) {
    const id = nanoid();
    runner
      .insert(interactions)
      .values({
        id,
        contactId,
        orgId: null,
        interactionType: eventType,
        direction: engagement.direction,
        summary: engagement.content,
        isMeaningful: false,
        occurredAt,
        scope: "shared",
        source,
        engagementId: engagement.id,
        contentItemId,
        contentPostId: engagement.contentPostId ?? null,
        platform: engagement.platform ?? null,
        workflowRunId: engagement.workflowRunId ?? null,
        metadata: engagement.platformData ?? "{}",
      })
      .run();

    const interaction = runner.select().from(interactions).where(eq(interactions.id, id)).get()!;
    touchContactLastInteraction(contactId, occurredAt, runner);
    return { kind: "interaction", row: interaction };
  }

  const activityId = nanoid();
  runner
    .insert(contentActivities)
    .values({
      id: activityId,
      activityType: eventType,
      direction: engagement.direction,
      summary: engagement.content,
      occurredAt,
      scope: "shared",
      source,
      engagementId: engagement.id,
      contentItemId,
      contentPostId: engagement.contentPostId ?? null,
      platform: engagement.platform ?? null,
      workflowRunId: engagement.workflowRunId ?? null,
      metadata: engagement.platformData ?? "{}",
    })
    .run();

  const activity = runner
    .select()
    .from(contentActivities)
    .where(eq(contentActivities.id, activityId))
    .get()!;
  return { kind: "activity", row: activity };
}
