import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createEngagement } from "@/lib/db/queries/engagements";
import { logInteraction } from "@/lib/db/queries/interactions";
import * as projection from "@/lib/db/queries/contact-interaction-projection";
import { recomputeContactLastInteraction } from "@/lib/db/queries/contact-interaction-projection";
import { syncInteractionFromEngagement } from "@/lib/db/engagement-interaction-sync";
import { ensurePlatformActorContact } from "@/lib/db/queries/platform-actor-contact";
import { db } from "@/lib/db/client";
import { contacts, engagements, interactions } from "@/lib/db/schema";
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

  it("skips interaction dual-write when actor cannot be resolved", () => {
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
      platformData: "{}",
    });

    expect(db.select().from(interactions).all()).toHaveLength(0);
    expect(syncInteractionFromEngagement(engagement)).toBeNull();
  });

  it("projects contactless engagement when actor platform identity is embedded", () => {
    ensurePlatformActorContact({
      platform: "x",
      platformUserId: "actor-1",
      displayName: "Me",
      platformHandle: "me",
    });

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
      platformData: JSON.stringify({ actorPlatformUserId: "actor-1", action: "like" }),
    });

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    expect(interaction).toBeTruthy();
    expect(interaction?.source).toBe("manual");
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
