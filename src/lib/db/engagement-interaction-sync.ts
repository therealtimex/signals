import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { contentPosts, interactions } from "@/lib/db/schema";
import type { Engagement, Interaction } from "@/lib/db/types";
import { touchContactLastInteraction } from "@/lib/db/queries/contact-interaction-projection";

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

/**
 * Dual-write an engagement into `interactions` (1:1 via `engagement_id`).
 * Idempotent — safe to call on every engagement insert.
 */
export function syncInteractionFromEngagement(
  engagement: Engagement,
  opts?: { source?: string },
  runner: DbRunner = db,
): Interaction | null {
  if (!engagement.contactId) return null;

  const existing = runner
    .select()
    .from(interactions)
    .where(eq(interactions.engagementId, engagement.id))
    .get();
  if (existing) {
    touchContactLastInteraction(engagement.contactId, existing.occurredAt, runner);
    return existing;
  }

  const id = nanoid();
  const occurredAt = engagement.createdAt;

  runner
    .insert(interactions)
    .values({
      id,
      contactId: engagement.contactId,
      orgId: null,
      interactionType: mapEngagementTypeToInteractionType(engagement.engagementType),
      direction: engagement.direction,
      summary: engagement.content,
      isMeaningful: false,
      occurredAt,
      scope: "shared",
      source: opts?.source ?? interactionSourceFromEngagement(engagement),
      engagementId: engagement.id,
      contentItemId: resolveContentItemId(engagement, runner),
      metadata: engagement.platformData ?? "{}",
    })
    .run();

  const interaction = runner.select().from(interactions).where(eq(interactions.id, id)).get()!;
  touchContactLastInteraction(engagement.contactId, occurredAt, runner);
  return interaction;
}
