import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { createIdentity } from "@/lib/db/queries/identities";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import { buildDedupeReview } from "./review";

function setEnrichmentScore(contactId: string, score: number): void {
  db.update(contacts).set({ enrichmentScore: score }).where(eq(contacts.id, contactId)).run();
}

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
  setEnrichmentScore(rich.id, 80);
  setEnrichmentScore(thin.id, 10);
  return { primaryId: rich.id, secondaryId: thin.id };
}

describe("buildDedupeReview", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns nothing when there are no duplicates", () => {
    createContact({ name: "Ada Lovelace" });
    createContact({ name: "Grace Hopper" });
    expect(buildDedupeReview()).toEqual([]);
  });

  it("hydrates each member with the facts a reviewer needs", () => {
    const { primaryId } = seedSharedEmailPair();
    createIdentity({
      contactId: primaryId,
      platform: "x",
      platformUserId: "1",
      platformHandle: "@sama",
    });

    const [group] = buildDedupeReview({ tiers: [1] });

    expect(group.tier).toBe(1);
    expect(group.confidence).toBe(1);
    const primary = group.members.find((m) => m.contactId === primaryId)!;
    expect(primary.email).toBe("sam@openai.com");
    // Handles render without the leading @ so `x:sama` matches the stored platform handle.
    expect(primary.handles).toContain("x:sama");
  });

  it("puts the suggested survivor first so the top row is always the keeper", () => {
    const { primaryId } = seedSharedEmailPair();

    const [group] = buildDedupeReview({ tiers: [1] });

    expect(group.members[0].contactId).toBe(primaryId);
    expect(group.members[0].isPrimary).toBe(true);
    expect(group.members.slice(1).every((m) => !m.isPrimary)).toBe(true);
  });

  it("reports missing facts as empty rather than inventing them", () => {
    const { secondaryId } = seedSharedEmailPair();

    const [group] = buildDedupeReview({ tiers: [1] });
    const secondary = group.members.find((m) => m.contactId === secondaryId)!;

    expect(secondary.company).toBeNull();
    expect(secondary.title).toBeNull();
    expect(secondary.handles).toEqual([]);
    expect(secondary.isPrimary).toBe(false);
  });
});
