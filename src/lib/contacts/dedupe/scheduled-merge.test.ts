import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import { runScheduledDedupeMerge } from "./scheduled-merge";

function seedSharedEmailPair(): { primaryId: string; secondaryId: string } {
  const rich = createContact({ name: "Sam Altman" });
  const thin = createContact({ name: "Samuel A." });
  for (const contact of [rich, thin]) {
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "sam@openai.com",
      source: "test",
    });
  }
  db.update(contacts).set({ enrichmentScore: 80 }).where(eq(contacts.id, rich.id)).run();
  return { primaryId: rich.id, secondaryId: thin.id };
}

describe("runScheduledDedupeMerge", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("leaves no run behind when there is nothing to merge", async () => {
    createContact({ name: "Ada Lovelace" });
    createContact({ name: "Grace Hopper" });

    await expect(runScheduledDedupeMerge()).resolves.toBeNull();
  });

  it("merges tier 1 duplicates and records the sweep as a run", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();

    const result = (await runScheduledDedupeMerge())!;

    expect(result.merged).toBe(1);
    expect(getContactById(secondaryId)?.metadata).toContain("mergedIntoContactId");
    expect(getWorkflowRun(result.workflowRunId!)?.status).toBe("completed");
  });

  it("never merges a tier 2 group, whatever the payload asks for", async () => {
    // Same name at the same org, no shared email or handle — a judgment call, so the sweep
    // must leave it for the review panel.
    const org = createOrg({ name: "OpenAI", source: "test" });
    const a = createContact({ name: "Greg Brockman" });
    const b = createContact({ name: "Greg Brockman" });
    for (const contact of [a, b]) {
      createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    }

    await expect(
      runScheduledDedupeMerge({ tiers: [1, 2, 3], minConfidence: 0 })
    ).resolves.toBeNull();
    expect(getContactById(b.id)?.metadata ?? "{}").not.toContain("mergedIntoContactId");
  });

  it("clamps the sweep size", async () => {
    seedSharedEmailPair();

    const result = (await runScheduledDedupeMerge({ limit: 10_000 }))!;

    expect(result.groups).toHaveLength(1);
  });
});
