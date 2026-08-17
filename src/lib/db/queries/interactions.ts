import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { assertInteractionType } from "@/lib/db/interaction-types";
import { touchContactLastInteraction } from "@/lib/db/queries/contact-interaction-projection";
import { touchRelationshipLastMeaningfulInteraction } from "@/lib/db/queries/contact-relationship";
import { interactions, mediaAssets, mediaAttachments } from "@/lib/db/schema";
import type { Interaction, NewInteraction } from "@/lib/db/types";

export class InteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionError";
  }
}

export type LogInteractionInput = {
  contactId: string;
  interactionType: string;
  occurredAt?: number;
  orgId?: string | null;
  direction?: "inbound" | "outbound" | "mutual" | null;
  summary?: string | null;
  isMeaningful?: boolean;
  scope?: "shared" | "local_only";
  source?: string;
  contentItemId?: string | null;
  attachmentIds?: string[];
  metadata?: Record<string, unknown>;
};

function attachMediaToInteraction(
  runner: DbRunner,
  interactionId: string,
  attachmentIds: string[],
  source: string,
): number {
  const uniqueIds = [...new Set(attachmentIds)];
  let sortOrder = 0;

  for (const assetId of uniqueIds) {
    const asset = runner
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .get();
    if (!asset) {
      throw new InteractionError(`Media asset not found: ${assetId}`);
    }

    const existing = runner
      .select({ id: mediaAttachments.id })
      .from(mediaAttachments)
      .where(
        and(
          eq(mediaAttachments.mediaAssetId, assetId),
          eq(mediaAttachments.parentType, "interaction"),
          eq(mediaAttachments.parentId, interactionId),
          eq(mediaAttachments.role, "attachment"),
        ),
      )
      .get();
    if (existing) continue;

    const now = Math.floor(Date.now() / 1000);
    runner
      .insert(mediaAttachments)
      .values({
        id: nanoid(),
        mediaAssetId: assetId,
        parentType: "interaction",
        parentId: interactionId,
        role: "attachment",
        sortOrder,
        source,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    sortOrder++;
  }

  return sortOrder;
}

export function logInteraction(input: LogInteractionInput): Interaction {
  const interactionType = assertInteractionType(input.interactionType);
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const values: NewInteraction = {
    id,
    contactId: input.contactId,
    orgId: input.orgId ?? null,
    interactionType,
    direction: input.direction ?? null,
    summary: input.summary ?? null,
    isMeaningful: input.isMeaningful ?? false,
    occurredAt: input.occurredAt ?? now,
    scope: input.scope ?? "local_only",
    source: input.source ?? "agent",
    engagementId: null,
    contentItemId: input.contentItemId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
  };

  return db.transaction((tx) => {
    tx.insert(interactions).values(values).run();
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      attachMediaToInteraction(
        tx,
        id,
        input.attachmentIds,
        input.source ?? "agent",
      );
    }
    const interaction = tx.select().from(interactions).where(eq(interactions.id, id)).get()!;
    touchContactLastInteraction(input.contactId, interaction.occurredAt, tx);
    if (interaction.isMeaningful) {
      touchRelationshipLastMeaningfulInteraction(input.contactId, interaction.occurredAt, tx);
    }
    return interaction;
  });
}

/** List sync-derived and manual interactions for a content post. */
export function listInteractionsByContentPost(contentPostId: string): Interaction[] {
  return db
    .select()
    .from(interactions)
    .where(eq(interactions.contentPostId, contentPostId))
    .orderBy(desc(interactions.occurredAt))
    .all();
}

export function countInteractionAttachments(interactionId: string): number {
  return db
    .select()
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.parentType, "interaction"),
        eq(mediaAttachments.parentId, interactionId),
      ),
    )
    .all().length;
}
