import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import { contactPersonas, identityMetrics } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

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
});
