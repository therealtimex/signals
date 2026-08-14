import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { runGraphBackfills } from "@/lib/db/backfills";
import { backfillOrgs } from "@/lib/db/backfills/orgs";
import { backfillWorksAt } from "@/lib/db/backfills/works-at";
import { backfillEngagedWithEdges } from "@/lib/db/backfills/engaged-with";
import { backfillInteractions } from "@/lib/db/backfills/interactions";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contentPosts,
  engagements,
  graphEdges,
  interactions,
  orgs,
  platformAccounts,
} from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("graph backfills", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates orgs and works_at edges from contacts.company", () => {
    createContact({
      name: "Alice",
      company: "Acme Corp",
      title: "CEO",
      platform: "x",
      platformUserId: "a1",
    });
    createContact({
      name: "Bob",
      company: "acme corp",
      title: "CTO",
      platform: "x",
      platformUserId: "b1",
    });

    const orgResult = backfillOrgs();
    expect(orgResult.inserted).toBe(1);

    const result = runGraphBackfills();
    expect(result.worksAt.upserted).toBe(2);

    const orgRows = db.select().from(orgs).all();
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0]?.source).toBe("backfill:contacts-company");

    const edges = db.select().from(graphEdges).all();
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.edgeType === "works_at")).toBe(true);
  });

  it("copies engagements into interactions idempotently", () => {
    const contact = createContact({ name: "Engager", platform: "x", platformUserId: "e1" });
    const contentItemId = nanoid();
    db.insert(contentItems)
      .values({
        id: contentItemId,
        contentType: "post",
        status: "imported",
      })
      .run();

    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "Test Account",
        authType: "session",
      })
      .run();

    const contentPostId = nanoid();
    db.insert(contentPosts)
      .values({
        id: contentPostId,
        contentItemId,
        platformAccountId,
        status: "imported",
      })
      .run();

    const engagementId = nanoid();
    db.insert(engagements)
      .values({
        id: engagementId,
        contactId: contact.id,
        engagementType: "like",
        direction: "outbound",
        contentPostId,
        createdAt: 1_700_000_000,
      })
      .run();

    const first = backfillInteractions();
    expect(first.inserted).toBe(1);

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagementId))
      .get();
    expect(interaction?.contentItemId).toBe(contentItemId);
    expect(interaction?.source).toBe("backfill:engagements");

    const second = backfillInteractions();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("is safe to run runGraphBackfills twice", () => {
    createContact({
      name: "Repeat",
      company: "Repeat Inc",
      platform: "x",
      platformUserId: "r1",
    });

    const first = runGraphBackfills();
    const second = runGraphBackfills();

    expect(first.orgs.inserted).toBe(1);
    expect(second.orgs.inserted).toBe(0);
    expect(db.select().from(orgs).all()).toHaveLength(1);
    expect(db.select().from(graphEdges).all()).toHaveLength(1);
  });

  it("does not aggregate local_only interactions into shared engaged_with edges", () => {
    const contact = createContact({ name: "Private", platform: "x", platformUserId: "p1" });
    const contentItemId = nanoid();
    db.insert(contentItems)
      .values({
        id: contentItemId,
        contentType: "post",
        status: "imported",
      })
      .run();

    db.insert(interactions)
      .values({
        id: nanoid(),
        contactId: contact.id,
        interactionType: "like",
        occurredAt: 1_700_000_000,
        scope: "local_only",
        source: "test",
        contentItemId,
        metadata: "{}",
      })
      .run();

    const result = backfillEngagedWithEdges();
    expect(result.upserted).toBe(0);
    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("backfillWorksAt reconciles stale employers after direct contact company update", () => {
    const contact = createContact({
      name: "Mover",
      company: "Alpha Corp",
      platform: "x",
      platformUserId: "bm1",
    });

    backfillWorksAt();
    updateContact(contact.id, { company: "Beta LLC" });
    backfillWorksAt();

    const worksAt = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "works_at"))
      .all();
    expect(worksAt).toHaveLength(1);
    const beta = db.select().from(orgs).where(eq(orgs.name, "Beta LLC")).get();
    expect(worksAt[0]?.dstId).toBe(beta?.id);
  });

  it("backfillWorksAt retires works_at edges after company is cleared", () => {
    const contact = createContact({
      name: "Clearer",
      company: "Alpha Corp",
      platform: "x",
      platformUserId: "cl1",
    });

    backfillWorksAt();
    updateContact(contact.id, { company: "" });
    backfillWorksAt();

    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });
});
