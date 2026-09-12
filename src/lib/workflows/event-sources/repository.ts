import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentItems } from "@/lib/db/schema";
import { graphEdges } from "@/lib/db/schema";
import { getOrgByDomain } from "@/lib/db/queries/orgs";
import { nanoid } from "nanoid";
import type { EventSource } from "@/lib/workflows/event-sources/types";
import { lumaEventKey } from "@/lib/workflows/event-sources/urls";

export function eventContentItemId(event: Pick<EventSource, "provider" | "key">): string {
  const digest = createHash("sha256")
    .update(`${event.provider}:${event.key}`)
    .digest("hex")
    .slice(0, 24);
  return `event_${event.provider}_${digest}`;
}

/** Transactional, idempotent projection of public event evidence into Content. */
export function upsertPublicEventSource(
  event: EventSource,
  options: { writeGraphEdges?: boolean } = {},
): string {
  const id = eventContentItemId(event);
  const now = Math.floor(Date.now() / 1000);
  const values = {
    id,
    title: event.title,
    body: event.location,
    contentType: "article" as const,
    platformTarget: event.canonicalUrl,
    status: "imported" as const,
    aiGenerated: false,
    origin: "imported" as const,
    direction: "inbound" as const,
    platformData: JSON.stringify({ eventSource: event }),
    updatedAt: now,
  };
  db.transaction((tx) => {
    const existing = tx
      .select({ platformData: contentItems.platformData })
      .from(contentItems)
      .where(eq(contentItems.id, id))
      .get();
    if (existing) {
      try {
        const stored = JSON.parse(existing.platformData ?? "{}") as {
          eventSource?: { provider?: unknown; key?: unknown };
        };
        if (
          !stored.eventSource ||
          (stored.eventSource.provider !== event.provider || stored.eventSource.key !== event.key)
        ) {
          throw new Error("event_source_key_conflict");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "event_source_key_conflict") throw error;
        throw new Error("event_source_key_conflict");
      }
    }
    tx.insert(contentItems)
      .values(values)
      .onConflictDoUpdate({
        target: contentItems.id,
        set: {
          title: values.title,
          body: values.body,
          platformTarget: values.platformTarget,
          platformData: values.platformData,
          updatedAt: now,
        },
      })
      .run();
    if (options.writeGraphEdges) {
      for (const party of event.parties) {
        if (!party.url) continue;
        if (
          party.entityType !== "organization" &&
          !(party.role === "venue_provided_by" && party.entityType === "place")
        ) continue;
        let hostname = "";
        try {
          hostname = new URL(party.url).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        const org = getOrgByDomain(hostname);
        if (!org) continue;
        tx.insert(graphEdges)
          .values({
            id: `edge_${nanoid()}`,
            srcType: "content",
            srcId: id,
            dstType: "org",
            dstId: org.id,
            edgeType: party.role,
            weight: 1,
            properties: JSON.stringify({ evidence: party.evidence }),
            scope: "shared",
            source: "import:luma",
          })
          .onConflictDoUpdate({
            target: [
              graphEdges.edgeType,
              graphEdges.srcType,
              graphEdges.srcId,
              graphEdges.dstType,
              graphEdges.dstId,
            ],
            set: {
              weight: 1,
              properties: JSON.stringify({ evidence: party.evidence }),
              lastSeenAt: now,
              updatedAt: now,
            },
          })
          .run();
      }
      for (const relatedUrl of event.relatedEventUrls) {
        const relatedKey = lumaEventKey(relatedUrl);
        if (!relatedKey) continue;
        const relatedId = eventContentItemId({ provider: "luma", key: relatedKey });
        const related = tx
          .select({ id: contentItems.id })
          .from(contentItems)
          .where(eq(contentItems.id, relatedId))
          .get();
        if (!related) continue;
        const relationshipEvidence = event.evidence.find(
          (entry) => entry.observedRole === "related_event" && entry.targetUrl === relatedUrl,
        );
        tx.insert(graphEdges)
          .values({
            id: `edge_${nanoid()}`,
            srcType: "content",
            srcId: id,
            dstType: "content",
            dstId: related.id,
            edgeType: "related_event",
            weight: 1,
            properties: JSON.stringify({ evidence: relationshipEvidence ?? null }),
            scope: "shared",
            source: "import:luma",
          })
          .onConflictDoUpdate({
            target: [
              graphEdges.edgeType,
              graphEdges.srcType,
              graphEdges.srcId,
              graphEdges.dstType,
              graphEdges.dstId,
            ],
            set: {
              weight: 1,
              properties: JSON.stringify({ evidence: relationshipEvidence ?? null }),
              lastSeenAt: now,
              updatedAt: now,
            },
          })
          .run();
      }
    }
  });
  return db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, id)).get()!.id;
}
