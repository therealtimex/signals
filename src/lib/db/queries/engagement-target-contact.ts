import { eq } from "drizzle-orm";
import { db, type DbRunner } from "@/lib/db/client";
import { contentItems, contentPosts } from "@/lib/db/schema";

/** Resolve the counterparty contact for an outbound action on a content post. */
export function resolveEngagementTargetContact(
  contentPostId: string,
  runner: DbRunner = db,
): string | null {
  const post = runner
    .select({ contentItemId: contentPosts.contentItemId })
    .from(contentPosts)
    .where(eq(contentPosts.id, contentPostId))
    .get();
  if (!post) return null;

  const item = runner
    .select({ contactId: contentItems.contactId })
    .from(contentItems)
    .where(eq(contentItems.id, post.contentItemId))
    .get();

  return item?.contactId ?? null;
}
