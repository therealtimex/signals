import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { engagements } from "@/lib/db/schema";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";
import { listInteractionsByContentPost } from "@/lib/db/queries/interactions";
import type { Engagement } from "@/lib/db/types";

type NewEngagementData = Omit<Engagement, "id" | "createdAt">;

/**
 * Sync-provenance write path for platform engagements.
 * Product reads use `interactions` — see `listInteractionsByContentPost`.
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

/** @deprecated Use listInteractionsByContentPost — reads interactions under the hood. */
export function listEngagementsByContentPost(contentPostId: string): Engagement[] {
  return listInteractionsByContentPost(contentPostId).map(interactionToEngagementView);
}

function interactionToEngagementView(
  interaction: ReturnType<typeof listInteractionsByContentPost>[number],
): Engagement {
  return {
    id: interaction.engagementId ?? interaction.id,
    contactId: interaction.contactId,
    platformAccountId: null,
    engagementType: mapInteractionTypeToEngagementType(interaction.interactionType) as Engagement["engagementType"],
    direction: interaction.direction === "mutual" ? "inbound" : (interaction.direction ?? "outbound"),
    content: interaction.summary,
    templateId: null,
    workflowRunId: interaction.workflowRunId,
    contentPostId: interaction.contentPostId,
    platform: interaction.platform,
    platformEngagementId: null,
    threadId: null,
    source: interaction.source,
    platformData: interaction.metadata,
    createdAt: interaction.occurredAt,
  };
}

function mapInteractionTypeToEngagementType(interactionType: string): string {
  if (interactionType === "intro") return "connection_request";
  if (interactionType === "share") return "retweet";
  return interactionType;
}

/** Look up an engagement by its platform-specific ID (dedup check). */
export function getEngagementByPlatformId(platformEngagementId: string): Engagement | undefined {
  return db
    .select()
    .from(engagements)
    .where(eq(engagements.platformEngagementId, platformEngagementId))
    .get();
}
