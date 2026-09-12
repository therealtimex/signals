import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { contentItems, graphEdges } from "@/lib/db/schema";
import { createOrg } from "@/lib/db/queries/orgs";
import { resetCoreTables } from "@/test/db";
import { extractLumaEventFromHtml } from "@/lib/workflows/event-sources/providers/luma";
import {
  eventContentItemId,
  upsertPublicEventSource,
} from "@/lib/workflows/event-sources/repository";

const HTML = `<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Event","name":"Build Friday",
  "organizer":{"@type":"Organization","name":"Acme","url":"https://acme.test/about"},
  "sponsor":{"@type":"Organization","name":"Lookalike","url":"https://sub.acme.test"}
}</script>`;

describe("public event repository", () => {
  beforeEach(() => resetCoreTables());

  it("upserts one non-authored content anchor and links only exact-domain existing orgs", () => {
    const org = createOrg({ name: "Acme", domain: "acme.test" });
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/BuildFriday?tk=secret",
      html: HTML,
      observedAt: 1_789_171_200,
    });

    const firstId = upsertPublicEventSource(event, { writeGraphEdges: true });
    const secondId = upsertPublicEventSource({ ...event, title: "Build Friday Updated" }, { writeGraphEdges: true });

    expect(firstId).toBe(eventContentItemId(event));
    expect(secondId).toBe(firstId);
    expect(db.select().from(contentItems).all()).toEqual([
      expect.objectContaining({
        id: firstId,
        title: "Build Friday Updated",
        contentType: "article",
        origin: "imported",
        status: "imported",
        aiGenerated: false,
      }),
    ]);
    expect(db.select().from(graphEdges).all()).toEqual([
      expect.objectContaining({
        srcType: "content",
        srcId: firstId,
        dstType: "org",
        dstId: org.id,
        edgeType: "organized_by",
      }),
    ]);
    expect(JSON.stringify(db.select().from(contentItems).all())).not.toContain("secret");
  });

  it("refuses to overwrite a non-event row at the deterministic content id", () => {
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/collision",
      html: HTML,
    });
    db.insert(contentItems).values({
      id: eventContentItemId(event),
      title: "Existing article",
      body: "User-owned content",
      contentType: "article",
      status: "imported",
      platformData: "{}",
    }).run();

    expect(() => upsertPublicEventSource(event)).toThrow("event_source_key_conflict");
    expect(db.select().from(contentItems).all()[0]?.title).toBe("Existing article");
  });

  it("links a related event only after both typed content anchors exist", () => {
    const root = extractLumaEventFromHtml({
      url: "https://luma.com/root",
      html: HTML.replace("</script>", "</script><a href=\"/related\">Related</a>"),
    });
    const related = extractLumaEventFromHtml({
      url: "https://luma.com/related",
      html: HTML.replace("Build Friday", "Related Event"),
    });

    upsertPublicEventSource(root, { writeGraphEdges: true });
    expect(db.select().from(graphEdges).all()).toHaveLength(0);
    upsertPublicEventSource(related, { writeGraphEdges: true });
    upsertPublicEventSource(root, { writeGraphEdges: true });

    expect(db.select().from(graphEdges).all()).toEqual([
      expect.objectContaining({
        srcId: eventContentItemId(root),
        dstId: eventContentItemId(related),
        edgeType: "related_event",
      }),
    ]);
  });
});
