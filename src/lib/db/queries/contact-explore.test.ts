import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrg } from "@/lib/db/queries/orgs";
import {
  deriveRelationship,
  getContactExploreCard,
  parsePersonaInterests,
  parsePersonaJsonStringArray,
  truncateExplorePostText,
} from "@/lib/db/queries/contact-explore";
import { selectPrimaryIdentity } from "@/components/explore/explore-utils";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import {
  contactPersonas,
  contentItems,
  contentPosts,
  graphEdges,
  identityMetrics,
  orgs,
  platformAccounts,
} from "@/lib/db/schema";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";
import { resetCoreTables } from "@/test/db";

function countDbSelectCalls(run: () => void): number {
  const spy = vi.spyOn(db, "select");
  run();
  const calls = spy.mock.calls.length;
  spy.mockRestore();
  return calls;
}

function seedPlatformAccount() {
  const id = nanoid();
  db.insert(platformAccounts)
    .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
    .run();
  return id;
}

describe("parsePersonaInterests", () => {
  it("returns string array or empty fallback for malformed JSON", () => {
    expect(parsePersonaInterests(JSON.stringify(["AI", "DevTools"]))).toEqual(["AI", "DevTools"]);
    expect(parsePersonaInterests("{not-json")).toEqual([]);
    expect(parsePersonaInterests(JSON.stringify({ foo: "bar" }))).toEqual([]);
    expect(parsePersonaInterests(JSON.stringify([1, "ok"]))).toEqual(["ok"]);
  });
});

describe("parsePersonaJsonStringArray", () => {
  it("parses conversion triggers and engagement formats", () => {
    expect(parsePersonaJsonStringArray(JSON.stringify(["case studies"]))).toEqual(["case studies"]);
    expect(parsePersonaJsonStringArray("not-json")).toEqual([]);
  });
});

describe("truncateExplorePostText", () => {
  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(300);
    expect(truncateExplorePostText(null, long)?.endsWith("…")).toBe(true);
    expect(truncateExplorePostText(null, long)?.length).toBe(281);
  });
});

describe("selectPrimaryIdentity", () => {
  it("prefers isPrimary then highest followers", () => {
    const primary = selectPrimaryIdentity([
      {
        id: "a",
        platform: "x",
        platformHandle: "@a",
        displayName: "A",
        followersCount: 10,
        followingCount: null,
        postsCount: null,
        listedCount: null,
        engagementRate: null,
        statsUpdatedAt: null,
        metricSnapshotAt: null,
        avatarUrl: null,
        bio: null,
        location: null,
        isVerified: null,
        platformCreatedAt: null,
        platformUrl: null,
        isPrimary: false,
        createdAt: 200,
      },
      {
        id: "b",
        platform: "x",
        platformHandle: "@b",
        displayName: "B",
        followersCount: 1,
        followingCount: null,
        postsCount: null,
        listedCount: null,
        engagementRate: null,
        statsUpdatedAt: null,
        metricSnapshotAt: null,
        avatarUrl: null,
        bio: null,
        location: null,
        isVerified: null,
        platformCreatedAt: null,
        platformUrl: null,
        isPrimary: true,
        createdAt: 300,
      },
    ]);
    expect(primary?.id).toBe("b");
  });
});

describe("deriveRelationship", () => {
  it("maps follows edges to labels with precedence", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "owner-1" });
    const follower = createContact({ name: "Fan", platform: "x", platformUserId: "fan-1" });
    updateContact(owner.id, { isSelf: true });

    upsertGraphEdge({
      srcType: "contact",
      srcId: follower.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
      source: "test",
    });

    expect(deriveRelationship(follower.id, owner.id)).toEqual({
      label: "Follower",
      edgeType: "follows",
    });
    expect(deriveRelationship(owner.id, owner.id)).toBeNull();
    expect(deriveRelationship(follower.id, null)).toBeNull();
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
      avatarUrl: "https://example.com/a.jpg",
      isVerified: true,
      platformCreatedAt: 1_600_000_000,
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
        conversionTriggers: JSON.stringify(["case studies"]),
        engagementFormats: JSON.stringify(["threads"]),
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
    expect(card.contact.name).toBe("Alice");
    expect(card.persona.visibility).toBe("shared");
    expect(card.persona.summary).toBe("Ships fast and shares learnings.");
    expect(card.persona.conversionTriggers).toEqual(["case studies"]);
    expect(card.persona.engagementFormats).toEqual(["threads"]);
    expect(card.identities[0]?.followersCount).toBe(1200);
    expect(card.identities[0]?.avatarUrl).toBe("https://example.com/a.jpg");
    expect(card.identities[0]?.isVerified).toBe(true);
    expect(card.niches).toHaveLength(1);
    expect(card.niches[0]?.name).toBe("AI Builders");
    expect(card.relationship).toBeNull();
    expect(card.org).toBeNull();
    expect(card.recentPosts).toEqual([]);
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
        conversionTriggers: JSON.stringify(["secret trigger"]),
        engagementFormats: JSON.stringify(["secret format"]),
        scope: "local_only",
      })
      .run();

    const card = getContactExploreCard(contact.id)!;
    expect(card.persona.visibility).toBe("local_only");
    expect(card.persona.archetype).toBeNull();
    expect(card.persona.summary).toBeNull();
    expect(card.persona.conversionTriggers).toEqual([]);
    expect(card.persona.engagementFormats).toEqual([]);
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
    expect(sparseSelects).toBeLessThanOrEqual(10);
  });

  it("marks shared personas stale by age only", () => {
    const contact = createContact({ name: "Stale" });
    const now = Math.floor(Date.now() / 1000);
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: contact.id,
        status: "active",
        summary: "Old persona",
        scope: "shared",
        generatedAt: now - PERSONA_STALE_AFTER_SECONDS - 1,
      })
      .run();

    const card = getContactExploreCard(contact.id)!;
    expect(card.persona.stale).toBe(true);
  });

  it("returns null stale for absent and local_only personas", () => {
    const absent = createContact({ name: "Absent" });
    expect(getContactExploreCard(absent.id)!.persona.stale).toBeNull();

    const local = createContact({ name: "Local" });
    db.insert(contactPersonas)
      .values({
        id: nanoid(),
        contactId: local.id,
        status: "active",
        summary: "Hidden",
        scope: "local_only",
      })
      .run();
    expect(getContactExploreCard(local.id)!.persona.stale).toBeNull();
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

  it("derives relationship chip from shared follows edges", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "owner-rel" });
    const subject = createContact({ name: "Subject", platform: "x", platformUserId: "sub-rel" });
    updateContact(owner.id, { isSelf: true });

    upsertGraphEdge({
      srcType: "contact",
      srcId: subject.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
      source: "test",
    });

    const card = getContactExploreCard(subject.id)!;
    expect(card.relationship).toEqual({ label: "Follower", edgeType: "follows" });
  });

  it("picks primary org by last_seen_at then weight", () => {
    const contact = createContact({ name: "Employee", platform: "x", platformUserId: "emp-1" });
    const acme = createOrg({ name: "Acme", domain: "acme.com", source: "test" });
    const beta = createOrg({ name: "Beta", domain: "beta.com", source: "test" });

    const acmeEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: acme.id,
      edgeType: "works_at",
      weight: 0.9,
      source: "test",
    });
    const betaEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: beta.id,
      edgeType: "works_at",
      weight: 0.1,
      source: "test",
    });
    db.update(graphEdges).set({ lastSeenAt: 100 }).where(eq(graphEdges.id, acmeEdge.id)).run();
    db.update(graphEdges).set({ lastSeenAt: 200 }).where(eq(graphEdges.id, betaEdge.id)).run();

    const card = getContactExploreCard(contact.id)!;
    expect(card.org?.name).toBe("Beta");
    expect(card.org?.domain).toBe("beta.com");
  });

  it("excludes dm and email from recent posts", () => {
    const contact = createContact({ name: "Poster", platform: "x", platformUserId: "poster-1" });
    const accountId = seedPlatformAccount();
    const now = Math.floor(Date.now() / 1000);

    for (const [contentType, body] of [
      ["post", "Public post"],
      ["dm", "Secret dm"],
      ["email", "Secret email"],
    ] as const) {
      const itemId = nanoid();
      db.insert(contentItems)
        .values({
          id: itemId,
          contactId: contact.id,
          contentType,
          body,
          origin: "received",
          status: "imported",
          createdAt: now,
        })
        .run();
      db.insert(contentPosts)
        .values({
          id: nanoid(),
          contentItemId: itemId,
          platformAccountId: accountId,
          platformUrl: `https://example.com/${contentType}`,
          publishedAt: now,
          status: "imported",
        })
        .run();
    }

    const card = getContactExploreCard(contact.id)!;
    expect(card.recentPosts).toHaveLength(1);
    expect(card.recentPosts[0]?.text).toBe("Public post");
    expect(card.recentPosts[0]?.url).toBe("https://example.com/post");
  });

  it("derives Mutual, Following, and Connected relationship labels with precedence", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "owner-mfc" });
    updateContact(owner.id, { isSelf: true });

    const mutual = createContact({ name: "Mutual", platform: "x", platformUserId: "mutual-1" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: mutual.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
      source: "test",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: mutual.id,
      edgeType: "follows",
      source: "test",
    });
    expect(getContactExploreCard(mutual.id)!.relationship).toEqual({
      label: "Mutual",
      edgeType: "follows",
    });

    const following = createContact({ name: "Following", platform: "x", platformUserId: "fol-1" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: following.id,
      edgeType: "follows",
      source: "test",
    });
    expect(getContactExploreCard(following.id)!.relationship).toEqual({
      label: "Following",
      edgeType: "follows",
    });

    const connected = createContact({ name: "Connected", platform: "x", platformUserId: "conn-1" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: connected.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "connected_to",
      source: "test",
    });
    expect(getContactExploreCard(connected.id)!.relationship).toEqual({
      label: "Connected",
      edgeType: "connected_to",
    });
  });

  it("ignores local_only relationship edges", () => {
    const owner = createContact({ name: "Owner", platform: "x", platformUserId: "owner-local" });
    const subject = createContact({ name: "Subject", platform: "x", platformUserId: "sub-local" });
    updateContact(owner.id, { isSelf: true });

    upsertGraphEdge({
      srcType: "contact",
      srcId: subject.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
      scope: "local_only",
      source: "test",
    });

    expect(getContactExploreCard(subject.id)!.relationship).toBeNull();
  });

  it("excludes local_only org and edge from org badge", () => {
    const contact = createContact({ name: "Worker", platform: "x", platformUserId: "worker-1" });
    const privateOrgId = nanoid();
    db.insert(orgs)
      .values({
        id: privateOrgId,
        name: "Private Co",
        scope: "local_only",
      })
      .run();
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: privateOrgId,
      edgeType: "works_at",
      scope: "local_only",
      source: "test",
    });

    expect(getContactExploreCard(contact.id)!.org).toBeNull();
  });

  it("picks org by weight and name when last_seen_at ties", () => {
    const contact = createContact({ name: "Worker2", platform: "x", platformUserId: "worker-2" });
    const alpha = createOrg({ name: "Alpha", domain: "alpha.com", source: "test" });
    const beta = createOrg({ name: "Beta", domain: "beta.com", source: "test" });

    const alphaEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: alpha.id,
      edgeType: "works_at",
      weight: 0.2,
      source: "test",
    });
    const betaEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: beta.id,
      edgeType: "works_at",
      weight: 0.8,
      source: "test",
    });
    db.update(graphEdges).set({ lastSeenAt: 100 }).where(eq(graphEdges.id, alphaEdge.id)).run();
    db.update(graphEdges).set({ lastSeenAt: 100 }).where(eq(graphEdges.id, betaEdge.id)).run();

    expect(getContactExploreCard(contact.id)!.org?.name).toBe("Beta");
  });

  it("caps recent posts at five and truncates long text", () => {
    const contact = createContact({ name: "Blogger", platform: "x", platformUserId: "blog-1" });
    const accountId = seedPlatformAccount();
    const now = Math.floor(Date.now() / 1000);

    for (let i = 0; i < 6; i += 1) {
      const itemId = nanoid();
      db.insert(contentItems)
        .values({
          id: itemId,
          contactId: contact.id,
          contentType: "post",
          body: i === 0 ? "a".repeat(300) : `Post ${i}`,
          origin: "imported",
          status: "imported",
          createdAt: now - i,
        })
        .run();
      db.insert(contentPosts)
        .values({
          id: nanoid(),
          contentItemId: itemId,
          platformAccountId: accountId,
          publishedAt: now - i,
          status: "imported",
        })
        .run();
    }

    const card = getContactExploreCard(contact.id)!;
    expect(card.recentPosts).toHaveLength(5);
    const truncated = card.recentPosts.find((post) => post.text.endsWith("…"));
    expect(truncated).toBeTruthy();
    expect(truncated!.text.length).toBe(281);
  });

  it("projects url and publishedAt from the same preferred content_posts row", () => {
    const contact = createContact({ name: "Mixed", platform: "x", platformUserId: "mixed-1" });
    const accountId = seedPlatformAccount();
    const itemId = nanoid();
    const older = 1_700_000_000;
    const newer = 1_700_000_100;

    db.insert(contentItems)
      .values({
        id: itemId,
        contactId: contact.id,
        contentType: "post",
        body: "Mixed row post",
        origin: "received",
        status: "imported",
        createdAt: older,
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: nanoid(),
        contentItemId: itemId,
        platformAccountId: accountId,
        platformUrl: "https://example.com/old",
        publishedAt: older,
        status: "imported",
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: nanoid(),
        contentItemId: itemId,
        platformAccountId: accountId,
        platformUrl: null,
        publishedAt: newer,
        status: "imported",
      })
      .run();

    const post = getContactExploreCard(contact.id)!.recentPosts[0];
    expect(post?.url).toBe("https://example.com/old");
    expect(post?.publishedAt).toBe(older);
  });
});
