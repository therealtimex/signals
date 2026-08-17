import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { createContact } from "@/lib/db/queries/contacts";
import { listContactTimeline } from "@/lib/db/queries/contact-timeline";
import { logInteraction } from "@/lib/db/queries/interactions";
import { createMediaAsset } from "@/lib/db/queries/media";
import { db } from "@/lib/db/client";
import { contentActivities, contentItems, mediaAttachments } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact timeline", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("unions interactions and contact-owned content activities with attachments", () => {
    const contact = createContact({ name: "Timeline", platform: "x", platformUserId: "tl-1" });
    const contentItemId = nanoid();
    db.insert(contentItems)
      .values({
        id: contentItemId,
        contentType: "post",
        status: "published",
        contactId: contact.id,
      })
      .run();

    const asset = createMediaAsset({
      filename: "notes.pdf",
      storagePath: "notes.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      origin: "upload",
      scope: "local_only",
    });

    const interaction = logInteraction({
      contactId: contact.id,
      interactionType: "meeting",
      summary: "Kickoff",
      attachmentIds: [asset.id],
      source: "test",
    });

    db.insert(contentActivities)
      .values({
        id: nanoid(),
        activityType: "view",
        direction: "inbound",
        summary: "Anonymous view",
        occurredAt: 1_700_000_100,
        scope: "shared",
        source: "test",
        contentItemId,
      })
      .run();

    const timeline = listContactTimeline(contact.id);
    expect(timeline.total).toBe(2);
    const meeting = timeline.data.find((item) => item.id === interaction.id);
    expect(meeting?.kind).toBe("interaction");
    expect(meeting?.attachments).toHaveLength(1);
    expect(meeting?.attachments[0]?.filename).toBe("notes.pdf");

    const activity = timeline.data.find((item) => item.kind === "content_activity");
    expect(activity?.eventType).toBe("view");
    expect(
      db.select().from(mediaAttachments).where(eq(mediaAttachments.parentId, interaction.id)).all(),
    ).toHaveLength(1);
  });

  it("rejects invalid interaction types on manual log", () => {
    const contact = createContact({ name: "Invalid", platform: "x", platformUserId: "bad-1" });
    expect(() =>
      logInteraction({
        contactId: contact.id,
        interactionType: "not_a_real_type",
        source: "test",
      }),
    ).toThrow(/Allowed types:/);
  });
});
