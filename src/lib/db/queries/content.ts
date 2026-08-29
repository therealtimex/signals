import { eq, ne, and, or, desc, count, SQL, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contentPosts,
  engagementMetrics,
  mediaAssets,
  mediaAttachments,
  platformAccounts,
} from "@/lib/db/schema";
import type { ContentItem, NewContentItem, ContentPost, NewContentPost, ContentItemWithPost, EngagementMetric, PaginatedResult } from "@/lib/db/types";
import { variants, graphEdges } from "@/lib/db/schema";
import { readVariantWritingProjection } from "@/lib/writing/variant-writing-projection";

export class ContentItemLinkedError extends Error {
  readonly code = "content_item_linked";
}

export type ContentItemMediaDetail = {
  id: string;
  mediaAssetId: string;
  role: string;
  sortOrder: number;
  caption: string | null;
  mimeType: string;
  filename: string;
};

export type ContentItemDetail = {
  item: ContentItem;
  post: ContentPost | null;
  latestMetrics: EngagementMetric | null;
  media: ContentItemMediaDetail[];
};

/** Attach post and latest metrics to content items (batch). */
function attachPostsAndMetrics(items: ContentItem[]): ContentItemWithPost[] {
  if (items.length === 0) return [];

  // Fetch all posts for these content items
  const allPosts = db
    .select()
    .from(contentPosts)
    .all();

  const postMap = new Map<string, ContentPost>();
  for (const post of allPosts) {
    postMap.set(post.contentItemId, post);
  }

  // Fetch latest metrics for each post
  const postIds = allPosts.map((p) => p.id);
  let metricsMap = new Map<string, EngagementMetric>();
  if (postIds.length > 0) {
    const allMetrics = db
      .select()
      .from(engagementMetrics)
      .orderBy(desc(engagementMetrics.snapshotAt))
      .all();

    // Keep only the latest metric per post
    for (const metric of allMetrics) {
      if (!metricsMap.has(metric.contentPostId)) {
        metricsMap.set(metric.contentPostId, metric);
      }
    }
  }

  return items.map((item) => {
    const post = postMap.get(item.id) ?? null;
    const metrics = post ? (metricsMap.get(post.id) ?? null) : null;
    return { ...item, post, metrics };
  });
}

export function listContentItems(opts?: {
  contentType?: string;
  origin?: string;
  platform?: string;
  status?: string;
  excludeStatus?: string;
  platformAccountId?: string;
  threadId?: string;
  page?: number;
  pageSize?: number;
}): PaginatedResult<ContentItemWithPost> {
  const conditions: SQL[] = [];

  if (opts?.contentType) {
    conditions.push(
      eq(contentItems.contentType, opts.contentType as ContentItem["contentType"])
    );
  }
  if (opts?.origin) {
    conditions.push(
      eq(contentItems.origin, opts.origin as "authored" | "received" | "imported")
    );
  }
  if (opts?.status) {
    conditions.push(
      eq(contentItems.status, opts.status as ContentItem["status"])
    );
  }
  if (opts?.excludeStatus) {
    conditions.push(
      ne(contentItems.status, opts.excludeStatus as ContentItem["status"])
    );
  }
  if (opts?.platform) {
    // Filter by platform: match via platformAccountId join OR platformTarget for drafts
    const accountIds = db
      .select({ id: platformAccounts.id })
      .from(platformAccounts)
      .where(eq(platformAccounts.platform, opts.platform as "x" | "linkedin" | "gmail" | "substack"))
      .all()
      .map((r) => r.id);

    if (accountIds.length > 0) {
      const accountConditions = accountIds.map((aid) =>
        eq(contentItems.platformAccountId, aid)
      );
      conditions.push(
        or(
          ...accountConditions,
          eq(contentItems.platformTarget, opts.platform)
        )!
      );
    } else {
      // No accounts for this platform — only match by platformTarget
      conditions.push(eq(contentItems.platformTarget, opts.platform));
    }
  }
  if (opts?.platformAccountId) {
    conditions.push(eq(contentItems.platformAccountId, opts.platformAccountId));
  }
  if (opts?.threadId) {
    conditions.push(eq(contentItems.threadId, opts.threadId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Skip pagination for thread lookups (ComposeDialog expects all thread items)
  if (opts?.threadId) {
    const rows = db
      .select()
      .from(contentItems)
      .where(whereClause)
      .orderBy(desc(contentItems.createdAt))
      .all();
    return { data: attachPostsAndMetrics(rows), total: rows.length };
  }

  const total = db
    .select({ value: count() })
    .from(contentItems)
    .where(whereClause)
    .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const rows = db
    .select()
    .from(contentItems)
    .where(whereClause)
    .orderBy(desc(contentItems.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: attachPostsAndMetrics(rows), total };
}

export function getContentItem(id: string): ContentItemWithPost | undefined {
  const row = db.select().from(contentItems).where(eq(contentItems.id, id)).get();
  if (!row) return undefined;
  return attachPostsAndMetrics([row])[0];
}

export function getContentItemDetail(id: string): ContentItemDetail | undefined {
  const item = db.select().from(contentItems).where(eq(contentItems.id, id)).get();
  if (!item) return undefined;

  const post =
    db
      .select()
      .from(contentPosts)
      .where(eq(contentPosts.contentItemId, id))
      .orderBy(desc(contentPosts.publishedAt), desc(contentPosts.id))
      .get() ?? null;
  const latestMetrics = post
    ? (db
        .select()
        .from(engagementMetrics)
        .where(eq(engagementMetrics.contentPostId, post.id))
        .orderBy(desc(engagementMetrics.snapshotAt), desc(engagementMetrics.id))
        .get() ?? null)
    : null;
  const media = db
    .select({
      id: mediaAttachments.id,
      mediaAssetId: mediaAttachments.mediaAssetId,
      role: mediaAttachments.role,
      sortOrder: mediaAttachments.sortOrder,
      caption: mediaAttachments.caption,
      mimeType: mediaAssets.mimeType,
      filename: mediaAssets.filename,
    })
    .from(mediaAttachments)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaAttachments.mediaAssetId))
    .where(
      and(
        eq(mediaAttachments.parentType, "content_item"),
        eq(mediaAttachments.parentId, id),
      ),
    )
    .orderBy(mediaAttachments.sortOrder, mediaAttachments.createdAt)
    .all();

  return { item, post, latestMetrics, media };
}

export function findContentItemByWritingIdempotencyKey(
  idempotencyKey: string,
): ContentItem | undefined {
  return db
    .select()
    .from(contentItems)
    .where(
      and(
        sql`json_valid(${contentItems.platformData})`,
        sql`json_extract(${contentItems.platformData}, '$.writing.idempotencyKey') = ${idempotencyKey}`,
      ),
    )
    .get();
}

export function createContentItem(
  data: Omit<NewContentItem, "id">,
  postData?: Omit<NewContentPost, "id" | "contentItemId">
): ContentItemWithPost {
  const id = nanoid();
  db.insert(contentItems).values({ ...data, id }).run();

  if (postData) {
    const postId = nanoid();
    db.insert(contentPosts).values({ ...postData, id: postId, contentItemId: id }).run();
  }

  return getContentItem(id)!;
}

export function updateContentItem(
  id: string,
  data: Partial<NewContentItem>
): ContentItemWithPost | undefined {
  const existing = db.select().from(contentItems).where(eq(contentItems.id, id)).get();
  if (!existing) return undefined;

  db.update(contentItems)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(contentItems.id, id))
    .run();

  return getContentItem(id);
}

export function deleteContentItem(id: string): boolean {
  const existing = db.select().from(contentItems).where(eq(contentItems.id, id)).get();
  if (!existing) return false;

  const linked = db.select().from(variants).where(eq(variants.contentItemId, id)).get();
  if (linked) {
    if (["queued", "publishing", "published", "scheduled"].includes(existing.status)) {
      throw new ContentItemLinkedError("Cannot delete content linked to a variant in the publish lane");
    }
    db.transaction(() => {
      const projection = readVariantWritingProjection(linked);
      const root = (() => { try { return JSON.parse(linked.metadata ?? "{}"); } catch { return {}; } })();
      const writing = projection
        ? { ...root.writing, approval: { ...root.writing.approval, state: "revoked", revokedReason: "user" }, materializedContentItemId: undefined }
        : undefined;
      db.update(variants).set({ contentItemId: null, ...(linked.status === "selected" ? { status: "draft" as const } : {}), ...(writing ? { metadata: JSON.stringify({ ...root, writing }) } : {}), updatedAt: Math.floor(Date.now() / 1000) }).where(eq(variants.id, linked.id)).run();
      db.delete(graphEdges).where(and(eq(graphEdges.srcType, "variant"), eq(graphEdges.srcId, linked.id), eq(graphEdges.dstType, "content"), eq(graphEdges.dstId, id), eq(graphEdges.edgeType, "materialized_as"))).run();
      db.delete(contentItems).where(eq(contentItems.id, id)).run();
    });
    return true;
  }
  db.delete(contentItems).where(eq(contentItems.id, id)).run();
  return true;
}

/** Check if a content post already exists by platformPostId + platformAccountId. */
export function getContentPostByPlatformId(
  platformPostId: string,
  platformAccountId: string
): ContentPost | undefined {
  return db
    .select()
    .from(contentPosts)
    .where(
      and(
        eq(contentPosts.platformPostId, platformPostId),
        eq(contentPosts.platformAccountId, platformAccountId)
      )
    )
    .get();
}

/** Get all content items in a thread, ordered by creation time. */
export function getThreadItems(threadId: string): ContentItemWithPost[] {
  const rows = db
    .select()
    .from(contentItems)
    .where(eq(contentItems.threadId, threadId))
    .orderBy(contentItems.createdAt)
    .all();

  return attachPostsAndMetrics(rows);
}

/** Create a standalone content post record (when the content item already exists). */
export function createContentPost(
  data: Omit<NewContentPost, "id">
): ContentPost {
  const id = nanoid();
  db.insert(contentPosts).values({ ...data, id }).run();
  return db.select().from(contentPosts).where(eq(contentPosts.id, id)).get()!;
}

/** Upsert an engagement metrics snapshot for a content post. */
export function upsertEngagementMetrics(
  contentPostId: string,
  metrics: Omit<NewContentPost, "id" | "contentItemId" | "platformAccountId"> & {
    likes: number;
    comments: number;
    shares: number;
    retweets: number;
    quotes: number;
    bookmarks: number;
    impressions: number;
  }
): void {
  const id = nanoid();
  db.insert(engagementMetrics)
    .values({
      id,
      contentPostId,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      retweets: metrics.retweets,
      quotes: metrics.quotes,
      bookmarks: metrics.bookmarks,
      impressions: metrics.impressions,
    })
    .run();
}
