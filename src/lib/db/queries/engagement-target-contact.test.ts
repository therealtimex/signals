import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createEngagement } from "@/lib/db/queries/engagements";
import { resolveEngagementTargetContact } from "@/lib/db/queries/engagement-target-contact";
import { db } from "@/lib/db/client";
import { contentItems, contentPosts, interactions, platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("engagement target contact", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("resolves counterparty from content item contactId", () => {
    const author = createContact({ name: "Author", platform: "x", platformUserId: "auth1" });
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@acct",
        authType: "oauth",
      })
      .run();

    const contentItemId = nanoid();
    const contentPostId = nanoid();
    db.insert(contentItems)
      .values({
        id: contentItemId,
        contentType: "post",
        status: "imported",
        contactId: author.id,
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: contentPostId,
        contentItemId,
        platformAccountId,
        status: "imported",
      })
      .run();

    expect(resolveEngagementTargetContact(contentPostId)).toBe(author.id);

    createEngagement({
      contactId: null,
      platformAccountId,
      engagementType: "like",
      direction: "outbound",
      contentPostId,
      platform: "x",
      source: "manual",
      platformEngagementId: null,
      content: null,
      templateId: null,
      workflowRunId: null,
      threadId: null,
      platformData: "{}",
    });

    const interaction = db.select().from(interactions).all()[0];
    expect(interaction?.contactId).toBe(author.id);
  });
});
