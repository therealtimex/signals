import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { syncGmailMetadata } from "@/lib/platforms/sync-gmail-metadata";
import { db } from "@/lib/db/client";
import { interactions, platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/platforms/gmail/client", () => ({
  getGmailMessagesByContact: vi.fn(),
  getGmailMessageMetadata: vi.fn(),
}));

import {
  getGmailMessagesByContact,
  getGmailMessageMetadata,
} from "@/lib/platforms/gmail/client";

describe("syncGmailMetadata", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(interactions).run();
    db.delete(platformAccounts).run();
    vi.clearAllMocks();

    vi.mocked(getGmailMessagesByContact).mockImplementation(async (_accountId, _email, opts) => {
      if (opts?.maxResults === 1) {
        return { messages: [{ id: "latest-msg", threadId: "thread-1" }] };
      }
      return { messages: [{ id: "count-msg", threadId: "thread-1" }] };
    });
    vi.mocked(getGmailMessageMetadata).mockResolvedValue({
      id: "latest-msg",
      threadId: "thread-1",
      internalDate: String(1_700_000_000_000),
    });
  });

  it("logs Gmail interactions as local_only by default", async () => {
    const accountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: accountId,
        platform: "gmail",
        displayName: "Test Gmail",
        authType: "oauth",
      })
      .run();

    const contact = createContact({
      name: "Mailbox",
      email: "mailbox@example.com",
      platform: "gmail",
      platformUserId: "g1",
    });

    await syncGmailMetadata(accountId, { maxContacts: 1 });

    const interaction = db
      .select()
      .from(interactions)
      .where(eq(interactions.contactId, contact.id))
      .get();

    expect(interaction).toBeTruthy();
    expect(interaction?.scope).toBe("local_only");
    expect(interaction?.source).toBe("sync:gmail");
  });
});
