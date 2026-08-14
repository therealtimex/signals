import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createEngagement } from "@/lib/db/queries/engagements";
import { logInteraction } from "@/lib/db/queries/interactions";
import * as projection from "@/lib/db/queries/contact-interaction-projection";
import { recomputeContactLastInteraction } from "@/lib/db/queries/contact-interaction-projection";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";
import { backfillInteractions } from "@/lib/db/backfills/interactions";
import { db } from "@/lib/db/client";
import { contacts, contentItems, contentPosts, engagements, interactions, platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("engagement → interaction dual-write", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("createEngagement writes a linked interaction and updates lastInteractionAt", () => {
    const contact = createContact({ name: "Sync User", platform: "x", platformUserId: "s1" });

    const engagement = createEngagement({
      contactId: contact.id,
      platformAccountId: null,
      engagementType: "like",
      direction: "outbound",
      content: null,
      templateId: null,
      workflowRunId: null,
      contentPostId: null,
      platform: "x",
      platformEngagementId: null,
      threadId: null,
      source: "manual",
      platformData: "{}",
    });

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    expect(interaction).toBeTruthy();
    expect(interaction?.interactionType).toBe("like");
    expect(interaction?.source).toBe("manual");

    const updated = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(updated?.lastInteractionAt).toBe(engagement.createdAt);
  });

  it("syncInteractionFromEngagement is idempotent", () => {
    const contact = createContact({ name: "Idempotent", platform: "x", platformUserId: "s2" });
    const engagement = createEngagement({
      contactId: contact.id,
      platformAccountId: null,
      engagementType: "comment",
      direction: "inbound",
      content: "Nice post",
      templateId: null,
      workflowRunId: null,
      contentPostId: null,
      platform: "linkedin",
      platformEngagementId: nanoid(),
      threadId: null,
      source: "timeline",
      platformData: "{}",
    });

    const first = syncInteractionFromEngagement(engagement);
    const second = syncInteractionFromEngagement(engagement);

    expect(first?.id).toBe(second?.id);
    expect(db.select().from(interactions).all()).toHaveLength(1);
    expect(second?.source).toBe("sync:linkedin");
  });

  it("logInteraction maintains lastInteractionAt projection", () => {
    const contact = createContact({ name: "Logger", platform: "x", platformUserId: "s3" });

    logInteraction({
      contactId: contact.id,
      interactionType: "meeting",
      occurredAt: 1_700_000_500,
      scope: "shared",
      source: "agent",
    });

    const updated = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(updated?.lastInteractionAt).toBe(1_700_000_500);

    logInteraction({
      contactId: contact.id,
      interactionType: "call",
      occurredAt: 1_700_000_200,
      scope: "shared",
      source: "agent",
    });

    const stillLatest = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(stillLatest?.lastInteractionAt).toBe(1_700_000_500);

    recomputeContactLastInteraction(contact.id);
    const recomputed = db.select().from(contacts).where(eq(contacts.id, contact.id)).get();
    expect(recomputed?.lastInteractionAt).toBe(1_700_000_500);
  });

  it("projects actor-only engagement without a contact", () => {
    const engagement = createEngagement({
      contactId: null,
      platformAccountId: null,
      engagementType: "like",
      direction: "outbound",
      content: null,
      templateId: null,
      workflowRunId: null,
      contentPostId: null,
      platform: "x",
      platformEngagementId: null,
      threadId: null,
      source: "manual",
      platformData: JSON.stringify({ action: "like", tweetId: "1" }),
    });

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    expect(interaction).toBeTruthy();
    expect(interaction?.contactId).toBeNull();
    expect(interaction?.source).toBe("manual");
    expect(db.select().from(contacts).all()).toHaveLength(0);
  });

  it("backfills legacy contactless X engagements into interactions", () => {
    const platformAccountId = nanoid();
    const contentItemId = nanoid();
    const contentPostId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@me",
        authType: "oauth",
      })
      .run();
    db.insert(contentItems)
      .values({ id: contentItemId, contentType: "post", status: "imported" })
      .run();
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
        contactId: null,
        engagementType: "like",
        direction: "outbound",
        contentPostId,
        platform: "x",
        source: "manual",
        platformData: JSON.stringify({ action: "like", tweetId: "legacy-1" }),
        createdAt: 1_700_000_000,
      })
      .run();

    const result = backfillInteractions();
    expect(result.inserted).toBe(1);

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagementId))
      .get();
    expect(interaction?.contentPostId).toBe(contentPostId);
    expect(interaction?.contactId).toBeNull();
  });

  it("rolls back logInteraction when projection update fails", () => {
    vi.spyOn(projection, "touchContactLastInteraction").mockImplementation(() => {
      throw new Error("projection failed");
    });

    const contact = createContact({ name: "Rollback", platform: "x", platformUserId: "rb1" });

    expect(() =>
      logInteraction({
        contactId: contact.id,
        interactionType: "meeting",
        occurredAt: 1_700_000_100,
        scope: "shared",
        source: "test",
      }),
    ).toThrow(/projection failed/);

    expect(db.select().from(interactions).all()).toHaveLength(0);
    expect(db.select().from(contacts).where(eq(contacts.id, contact.id)).get()?.lastInteractionAt).toBeNull();
  });

  it("rolls back createEngagement when projection update fails", () => {
    vi.spyOn(projection, "touchContactLastInteraction").mockImplementation(() => {
      throw new Error("projection failed");
    });

    const contact = createContact({ name: "Eng Rollback", platform: "x", platformUserId: "rb2" });

    expect(() =>
      createEngagement({
        contactId: contact.id,
        platformAccountId: null,
        engagementType: "like",
        direction: "outbound",
        content: null,
        templateId: null,
        workflowRunId: null,
        contentPostId: null,
        platform: "x",
        platformEngagementId: null,
        threadId: null,
        source: "manual",
        platformData: "{}",
      }),
    ).toThrow(/projection failed/);

    expect(db.select().from(engagements).all()).toHaveLength(0);
    expect(db.select().from(interactions).all()).toHaveLength(0);
    expect(db.select().from(contacts).where(eq(contacts.id, contact.id)).get()?.lastInteractionAt).toBeNull();
  });
});
