import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { createContact, listContacts } from "@/lib/db/queries/contacts";
import { createEngagement, listEngagementsByContentPost } from "@/lib/db/queries/engagements";
import {
  getEngagementDirectionSummary,
  getEngagementTypeBreakdown,
  getEngagementVolume,
  getTopEngagedContacts,
} from "@/lib/db/queries/analytics";
import { listInteractionsByContentPost, logInteraction } from "@/lib/db/queries/interactions";
import { backfillInteractions } from "@/lib/db/backfills/interactions";
import { backfillInteractionReadParity } from "@/lib/db/backfills/interaction-read-parity";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contentPosts,
  engagements,
  interactions,
  platformAccounts,
} from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("engagements read retirement", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedEngagement(opts?: { contentPostId?: string; platform?: "x" }) {
    const contact = createContact({ name: "Reader", platform: "x", platformUserId: "er1" });
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "Acct",
        authType: "session",
      })
      .run();

    let contentPostId = opts?.contentPostId;
    if (!contentPostId) {
      const contentItemId = nanoid();
      db.insert(contentItems)
        .values({ id: contentItemId, contentType: "post", status: "imported" })
        .run();
      contentPostId = nanoid();
      db.insert(contentPosts)
        .values({
          id: contentPostId,
          contentItemId,
          platformAccountId,
          status: "imported",
        })
        .run();
    }

    const engagement = createEngagement({
      contactId: contact.id,
      engagementType: "like",
      direction: "outbound",
      contentPostId,
      platform: opts?.platform ?? "x",
      source: "manual",
      platformEngagementId: nanoid(),
      platformAccountId: null,
      content: "nice post",
      templateId: null,
      workflowRunId: null,
      threadId: null,
      platformData: "{}",
    });

    return { contact, contentPostId, engagement };
  }

  it("dual-writes parity columns onto interactions", () => {
    const { contentPostId, engagement } = seedEngagement();
    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.engagementId, engagement.id))
      .get();

    expect(interaction?.contentPostId).toBe(contentPostId);
    expect(interaction?.platform).toBe("x");
  });

  it("backfills parity columns for legacy interaction rows", () => {
    const contact = createContact({ name: "Legacy", platform: "x", platformUserId: "lg1" });
    const engagementId = nanoid();
    const contentPostId = nanoid();
    const contentItemId = nanoid();
    const platformAccountId = nanoid();

    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "Acct",
        authType: "session",
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
    db.insert(engagements)
      .values({
        id: engagementId,
        contactId: contact.id,
        engagementType: "comment",
        direction: "inbound",
        contentPostId,
        platform: "x",
        createdAt: 1_700_000_100,
      })
      .run();
    db.insert(interactions)
      .values({
        id: nanoid(),
        contactId: contact.id,
        interactionType: "comment",
        direction: "inbound",
        occurredAt: 1_700_000_100,
        scope: "shared",
        source: "backfill:engagements",
        engagementId,
        metadata: "{}",
      })
      .run();

    const result = backfillInteractionReadParity();
    expect(result.updated).toBe(1);

    const rows = listInteractionsByContentPost(contentPostId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform).toBe("x");
  });

  it("analytics queries read interactions with parity to engagement counts", () => {
    const { engagement } = seedEngagement();
    const since = engagement.createdAt - 1;

    const volume = getEngagementVolume(since);
    expect(volume).toHaveLength(1);
    expect(volume[0]?.type).toBe("like");
    expect(volume[0]?.count).toBe(1);
    expect(getEngagementTypeBreakdown(since)).toEqual([{ type: "like", count: 1 }]);
    expect(getEngagementDirectionSummary(since)[0]?.outbound).toBe(1);
    expect(getTopEngagedContacts(since)[0]?.count).toBe(1);
  });

  it("includes local-only interactions in local analytics dashboards", () => {
    const contact = createContact({ name: "Private", platform: "x", platformUserId: "loc1" });
    logInteraction({
      contactId: contact.id,
      interactionType: "meeting",
      scope: "local_only",
      source: "agent",
    });

    const since = Math.floor(Date.now() / 1000) - 60;
    expect(getEngagementTypeBreakdown(since)).toEqual([{ type: "meeting", count: 1 }]);
  });

  it("surfaces X manual actions in content history via actor-only interactions", () => {
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@me",
        authType: "oauth",
      })
      .run();

    const contentItemId = nanoid();
    const contentPostId = nanoid();
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

    createEngagement({
      contactId: null,
      platformAccountId,
      engagementType: "like",
      direction: "outbound",
      content: null,
      templateId: null,
      workflowRunId: null,
      contentPostId,
      platform: "x",
      platformEngagementId: null,
      threadId: null,
      source: "manual",
      platformData: JSON.stringify({ action: "like", tweetId: "tweet-1" }),
    });

    expect(listContacts().total).toBe(0);

    const history = listEngagementsByContentPost(contentPostId);
    expect(history).toHaveLength(1);
    expect(history[0]?.engagementType).toBe("like");
    expect(history[0]?.source).toBe("manual");
    expect(getTopEngagedContacts(Math.floor(Date.now() / 1000) - 60)).toHaveLength(0);
  });

  it("backfills pre-upgrade contactless X rows into readable content history", () => {
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
        platformData: JSON.stringify({ action: "like", tweetId: "legacy-tweet" }),
        createdAt: 1_700_000_000,
      })
      .run();

    backfillInteractions();

    const history = listEngagementsByContentPost(contentPostId);
    expect(history).toHaveLength(1);
    expect(history[0]?.engagementType).toBe("like");
  });
});
