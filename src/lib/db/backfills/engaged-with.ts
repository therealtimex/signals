import { isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { interactions } from "@/lib/db/schema";
import { upsertGraphEdge } from "@/lib/db/queries/graph";

const SOURCE = "backfill:engagements";

/** Aggregate interaction rows into `engaged_with` edges (contact → content). */
export function backfillEngagedWithEdges(): { upserted: number } {
  const rows = db
    .select({
      contactId: interactions.contactId,
      contentItemId: interactions.contentItemId,
    })
    .from(interactions)
    .where(isNotNull(interactions.contentItemId))
    .all();

  const counts = new Map<string, { contactId: string; contentItemId: string; count: number }>();

  for (const row of rows) {
    if (!row.contentItemId) continue;
    const key = `${row.contactId}:${row.contentItemId}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, {
        contactId: row.contactId,
        contentItemId: row.contentItemId,
        count: 1,
      });
    }
  }

  let upserted = 0;
  for (const { contactId, contentItemId, count } of counts.values()) {
    upsertGraphEdge({
      srcType: "contact",
      srcId: contactId,
      dstType: "content",
      dstId: contentItemId,
      edgeType: "engaged_with",
      properties: JSON.stringify({ count, engagement_type: "aggregated" }),
      scope: "shared",
      source: SOURCE,
    });
    upserted++;
  }

  return { upserted };
}
