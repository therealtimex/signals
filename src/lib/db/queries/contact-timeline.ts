import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  interactionTypeCategory,
  type InteractionType,
  isInteractionType,
} from "@/lib/db/interaction-types";
import { listAttachmentsForParent } from "@/lib/db/queries/media-attachments";
import { contentActivities, contentItems, interactions, mediaAssets } from "@/lib/db/schema";
import { serializeMediaAttachment, type MediaAttachmentDTO } from "@/lib/serializers/media-attachment";
import type { PaginatedResult } from "@/lib/db/types";

export type ContactTimelineItem = {
  id: string;
  kind: "interaction" | "content_activity";
  eventType: string;
  category: ReturnType<typeof interactionTypeCategory> | "other";
  direction: "inbound" | "outbound" | "mutual" | null;
  summary: string | null;
  occurredAt: number;
  scope: "shared" | "local_only";
  source: string;
  contentItemId: string | null;
  contentPostId: string | null;
  platform: string | null;
  isMeaningful: boolean;
  attachments: MediaAttachmentDTO[];
};

type TimelineRow = {
  id: string;
  kind: "interaction" | "content_activity";
  eventType: string;
  direction: "inbound" | "outbound" | "mutual" | null;
  summary: string | null;
  occurredAt: number;
  scope: "shared" | "local_only";
  source: string;
  contentItemId: string | null;
  contentPostId: string | null;
  platform: string | null;
  isMeaningful: number;
};

function resolveAttachments(
  parentType: "interaction" | "content_item",
  parentId: string,
): MediaAttachmentDTO[] {
  const attachments = listAttachmentsForParent(parentType, parentId);
  const rows: MediaAttachmentDTO[] = [];
  for (const attachment of attachments) {
    const asset = db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, attachment.mediaAssetId))
      .get();
    if (!asset) continue;
    rows.push(serializeMediaAttachment(attachment, asset));
  }
  return rows;
}

function eventCategory(eventType: string): ContactTimelineItem["category"] {
  if (isInteractionType(eventType)) {
    return interactionTypeCategory(eventType as InteractionType);
  }
  return "other";
}

export function listContactTimeline(
  contactId: string,
  opts?: { page?: number; pageSize?: number },
): PaginatedResult<ContactTimelineItem> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const interactionRows = db
    .select({
      id: interactions.id,
      eventType: interactions.interactionType,
      direction: interactions.direction,
      summary: interactions.summary,
      occurredAt: interactions.occurredAt,
      scope: interactions.scope,
      source: interactions.source,
      contentItemId: interactions.contentItemId,
      contentPostId: interactions.contentPostId,
      platform: interactions.platform,
      isMeaningful: interactions.isMeaningful,
    })
    .from(interactions)
    .where(eq(interactions.contactId, contactId))
    .all()
    .map((row) => ({
      ...row,
      kind: "interaction" as const,
      isMeaningful: row.isMeaningful ? 1 : 0,
    }));

  const activityRows = db
    .select({
      id: contentActivities.id,
      eventType: contentActivities.activityType,
      direction: contentActivities.direction,
      summary: contentActivities.summary,
      occurredAt: contentActivities.occurredAt,
      scope: contentActivities.scope,
      source: contentActivities.source,
      contentItemId: contentActivities.contentItemId,
      contentPostId: contentActivities.contentPostId,
      platform: contentActivities.platform,
    })
    .from(contentActivities)
    .innerJoin(contentItems, eq(contentItems.id, contentActivities.contentItemId))
    .where(eq(contentItems.contactId, contactId))
    .all()
    .map((row) => ({
      ...row,
      kind: "content_activity" as const,
      isMeaningful: 0,
    }));

  const merged: TimelineRow[] = [...interactionRows, ...activityRows].sort(
    (a, b) => b.occurredAt - a.occurredAt,
  );
  const total = merged.length;
  const pageRows = merged.slice(offset, offset + pageSize);

  const data = pageRows.map((row) => {
    const attachments =
      row.kind === "interaction"
        ? resolveAttachments("interaction", row.id)
        : row.contentItemId
          ? resolveAttachments("content_item", row.contentItemId)
          : [];

    return {
      id: row.id,
      kind: row.kind,
      eventType: row.eventType,
      category: eventCategory(row.eventType),
      direction: row.direction,
      summary: row.summary,
      occurredAt: row.occurredAt,
      scope: row.scope,
      source: row.source,
      contentItemId: row.contentItemId,
      contentPostId: row.contentPostId,
      platform: row.platform,
      isMeaningful: row.isMeaningful === 1,
      attachments,
    };
  });

  return { data, total };
}

export function listInteractionsForContact(contactId: string) {
  return db
    .select()
    .from(interactions)
    .where(eq(interactions.contactId, contactId))
    .orderBy(desc(interactions.occurredAt))
    .all();
}
