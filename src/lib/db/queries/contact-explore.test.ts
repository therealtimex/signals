import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import {
  getContactExploreCard,
  parsePersonaInterests,
} from "@/lib/db/queries/contact-explore";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import { contactPersonas, identityMetrics } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function countDbSelectCalls(run: () => void): number {
  const spy = vi.spyOn(db, "select");
  run();
  const calls = spy.mock.calls.length;
  spy.mockRestore();
  return calls;
}

describe("parsePersonaInterests", () => {
  it("returns string array or empty fallback for malformed JSON", () => {
    expect(parsePersonaInterests(JSON.stringify(["AI", "DevTools"]))).toEqual(["AI", "DevTools"]);
    expect(parsePersonaInterests("{not-json")).toEqual([]);
    expect(parsePersonaInterests(JSON.stringify({ foo: "bar" }))).toEqual([]);
    expect(parsePersonaInterests(JSON.stringify([1, "ok"]))).toEqual(["ok"]);
  });
});

describe("getContactExploreCard", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns shared persona, identity metrics, and niche chips", () => {
    const contact = createContact({ name: "Alice" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "alice-1",
      isPrimary: 1,
      isActive: 1,
    });

    db.insert(identityMetrics)
      .values({
        id: nanoid(),
        contactIdentityId: identity.id,
        followersCount: 1200,
        followingCount: 300,
        postsCount: 88,
        engagementRate: 0.045,
      })
      .run();

    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        archetype: "Builder",
        tone: "Direct",
        summary: "Ships fast and shares learnings.",
        interests: JSON.stringify(["DevTools", "AI"]),
        confidence: 0.82,
        scope: "shared",
      })
      .run();

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

    const card = getContactExploreCard(contact.id)!;
    expect(card.persona.visibility).toBe("shared");
    expect(card.persona.summary).toBe("Ships fast and shares learnings.");
    expect(card.identities[0]?.followersCount).toBe(1200);
    expect(card.identities[0]?.engagementRate).toBe(0.045);
    expect(card.niches).toHaveLength(1);
    expect(card.niches[0]?.name).toBe("AI Builders");
  });

  it("hides local_only persona content while signaling visibility", () => {
    const contact = createContact({ name: "Private", platform: "x", platformUserId: "priv-1" });
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        archetype: "Secret",
        summary: "Should not leak",
        scope: "local_only",
      })
      .run();

    const card = getContactExploreCard(contact.id)!;
    expect(card.persona.visibility).toBe("local_only");
    expect(card.persona.archetype).toBeNull();
    expect(card.persona.summary).toBeNull();
  });

  it("returns undefined for unknown contacts", () => {
    expect(getContactExploreCard("missing-contact")).toBeUndefined();
  });

  it("uses a bounded number of select queries regardless of identity and niche count", () => {
    const sparse = createContact({ name: "Sparse" });
    createIdentity({
      contactId: sparse.id,
      platform: "x",
      platformUserId: "sparse-1",
      isPrimary: 1,
      isActive: 1,
    });
    const sparseNiche = ensureNicheByName("Sparse Niche", { source: "test" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: sparse.id,
      dstType: "niche",
      dstId: sparseNiche.id,
      edgeType: "belongs_to_niche",
      source: "test",
    });
    const sparseSelects = countDbSelectCalls(() => {
      getContactExploreCard(sparse.id);
    });

    const dense = createContact({ name: "Dense" });
    for (let i = 0; i < 5; i++) {
      const identity = createIdentity({
        contactId: dense.id,
        platform: "x",
        platformUserId: `dense-${i}`,
        isPrimary: i === 0 ? 1 : 0,
        isActive: 1,
      });
      db.insert(identityMetrics)
        .values({
          id: nanoid(),
          contactIdentityId: identity.id,
          followersCount: 100 + i,
        })
        .run();
    }
    for (let i = 0; i < 5; i++) {
      const niche = ensureNicheByName(`Dense Niche ${i}`, { source: "test" });
      upsertGraphEdge({
        srcType: "contact",
        srcId: dense.id,
        dstType: "niche",
        dstId: niche.id,
        edgeType: "belongs_to_niche",
        weight: 0.5 + i * 0.1,
        source: "test",
      });
    }
    const denseSelects = countDbSelectCalls(() => {
      getContactExploreCard(dense.id);
    });

    expect(sparseSelects).toBe(denseSelects);
    expect(sparseSelects).toBeLessThanOrEqual(5);
  });

  it("tolerates malformed persona interests JSON", () => {
    const contact = createContact({ name: "Bad JSON" });
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        interests: "{not-json",
        scope: "shared",
      })
      .run();

    const card = getContactExploreCard(contact.id)!;
    expect(card.persona.visibility).toBe("shared");
    expect(card.persona.interests).toEqual([]);
  });
});
