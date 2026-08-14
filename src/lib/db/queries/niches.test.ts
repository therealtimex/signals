import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  ensureNicheByName,
  listNiches,
  upsertNiche,
} from "@/lib/db/queries/niches";
import { db } from "@/lib/db/client";
import { contactPersonas, graphEdges, niches } from "@/lib/db/schema";
import { backfillNichesFromInterests } from "@/lib/db/backfills/niches-from-interests";
import { resetCoreTables } from "@/test/db";

describe("niche queries", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("dedupes niches by slug", () => {
    const first = ensureNicheByName("Startup Operators", { source: "test" });
    const second = ensureNicheByName("startup operators", { source: "test" });
    expect(second.id).toBe(first.id);
    expect(db.select().from(niches).all()).toHaveLength(1);
  });

  it("creates belongs_to_niche edges via graph layer", () => {
    const contact = createContact({ name: "Alice", platform: "x", platformUserId: "n1" });
    const niche = ensureNicheByName("AI Builders", { source: "test" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: niche.id,
      edgeType: "belongs_to_niche",
      weight: 0.9,
      source: "test",
    });

    const result = listNiches();
    expect(result.data[0]?.memberCount).toBe(1);
  });

  it("backfills persona interests into niches and edges", () => {
    const contact = createContact({ name: "Bob", platform: "x", platformUserId: "n2" });
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        interests: JSON.stringify(["DevTools", "Open Source"]),
        confidence: 0.8,
        scope: "shared",
      })
      .run();

    const first = backfillNichesFromInterests();
    expect(first.nichesCreated).toBe(2);
    expect(first.edgesUpserted).toBe(2);

    const second = backfillNichesFromInterests();
    expect(second.nichesCreated).toBe(0);

    const edges = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "belongs_to_niche"))
      .all();
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.weight === 0.8)).toBe(true);
  });

  it("upserts niche by id", () => {
    const created = upsertNiche({ name: "Growth" });
    const updated = upsertNiche({
      id: created.id,
      name: "Growth Marketing",
      description: "GTM operators",
    });
    expect(updated.name).toBe("Growth Marketing");
    expect(updated.slug).toBe("growth-marketing");
  });

  it("forwards includeLocalOnly to niche member counts", () => {
    const contact = createContact({ name: "Local", platform: "x", platformUserId: "loc-n" });
    const niche = ensureNicheByName("Private Club", {
      source: "test",
      scope: "local_only",
    });

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: niche.id,
      edgeType: "belongs_to_niche",
      scope: "local_only",
      source: "test",
    });

    const publicView = listNiches({ includeLocalOnly: false });
    expect(publicView.data).toHaveLength(0);

    const privateView = listNiches({ includeLocalOnly: true });
    expect(privateView.data[0]?.memberCount).toBe(1);
  });
});
