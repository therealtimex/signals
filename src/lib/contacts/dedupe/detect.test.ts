import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrg } from "@/lib/db/queries/orgs";
import { contacts, contentItems, interactions } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import { findDuplicateContacts, pickPrimary } from "./detect";
import { mergeContacts } from "./merge";

function seedContentItem(): string {
  const id = nanoid();
  db.insert(contentItems).values({ id, contentType: "post" }).run();
  return id;
}

function seedInteraction(contactId: string, contentItemId: string): void {
  db.insert(interactions)
    .values({
      id: nanoid(),
      contactId,
      contentItemId,
      interactionType: "reply",
      occurredAt: 1_700_000_000,
      source: "test",
    })
    .run();
}

function setEnrichmentScore(contactId: string, score: number): void {
  db.update(contacts).set({ enrichmentScore: score }).where(eq(contacts.id, contactId)).run();
}

describe("findDuplicateContacts", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns nothing when there is nothing to merge", () => {
    createContact({ name: "Ada Lovelace" });
    createContact({ name: "Grace Hopper" });
    expect(findDuplicateContacts()).toEqual([]);
  });

  it("Tier 1: matches on a shared normalized email", () => {
    const a = createContact({ name: "Sam Altman" });
    const b = createContact({ name: "Samuel A." });
    createContactChannel({
      contactId: a.id,
      channelType: "email",
      value: "sam@openai.com",
      source: "test",
    });
    createContactChannel({
      contactId: b.id,
      channelType: "email",
      value: "  SAM@OpenAI.com ",
      source: "test",
    });

    const [candidate] = findDuplicateContacts();
    expect(candidate).toMatchObject({
      tier: 1,
      confidence: 1,
      reason: "Shared normalized email address",
    });
    expect([candidate.primaryContactId, ...candidate.secondaryContactIds].sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it("Tier 1: matches on the same handle claimed under different platform user ids", () => {
    // The archive import and the CSV import minted different platformUserIds for
    // one account, so the unique claim index never caught them.
    const a = createContact({ name: "Sam Altman" });
    const b = createContact({ name: "Sam Altman (X archive)" });
    createIdentity({
      contactId: a.id,
      platform: "x",
      platformUserId: "1605",
      platformHandle: "sama",
    });
    createIdentity({
      contactId: b.id,
      platform: "x",
      platformUserId: "csv-import-42",
      platformHandle: "@SamA",
    });

    const [candidate] = findDuplicateContacts();
    expect(candidate).toMatchObject({
      tier: 1,
      confidence: 1,
      reason: "Shared platform handle on the same platform",
    });
  });

  it("Tier 2: matches an identical normalized name at the same organization", () => {
    const org = createOrg({ name: "Google DeepMind", source: "test" });
    const a = createContact({ name: "Demis Hassabis" });
    const b = createContact({ name: "demis  hassabis" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });

    const [candidate] = findDuplicateContacts();
    expect(candidate).toMatchObject({
      tier: 2,
      confidence: 0.95,
      reason: "Identical normalized name at the same organization",
    });
  });

  it("Tier 2: matches a near name at the same organization", () => {
    const org = createOrg({ name: "NVIDIA", source: "test" });
    const a = createContact({ name: "Jim Fan" });
    const b = createContact({ name: "Jim Linxi Fan" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });

    const [candidate] = findDuplicateContacts();
    expect(candidate.tier).toBe(2);
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.8);
    expect(candidate.confidence).toBeLessThanOrEqual(0.95);
  });

  it("Tier 2: does not fire on the same name at different organizations", () => {
    const deepmind = createOrg({ name: "Google DeepMind", source: "test" });
    const nvidia = createOrg({ name: "NVIDIA", source: "test" });
    const a = createContact({ name: "Alex Kim" });
    const b = createContact({ name: "Alex Kim" });
    createContactEmployment({ contactId: a.id, orgId: deepmind.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: nvidia.id, source: "test" });

    expect(findDuplicateContacts()).toEqual([]);
  });

  it("Tier 3: matches on a shared employment node plus overlapping interaction threads", () => {
    const org = createOrg({ name: "Acme", source: "test" });
    // Name similarity 0.5 — too weak for Tier 2, so only the graph can link these.
    const a = createContact({ name: "Ada Lovelace" });
    const b = createContact({ name: "Ada Byron King" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });

    const thread = seedContentItem();
    seedInteraction(a.id, thread);
    seedInteraction(b.id, thread);

    const [candidate] = findDuplicateContacts();
    expect(candidate).toMatchObject({
      tier: 3,
      reason: "Shared employment node and overlapping interaction threads",
    });
    expect(candidate.confidence).toBeCloseTo(0.6, 5);
  });

  it("Tier 3: does not fire without an interaction overlap", () => {
    const org = createOrg({ name: "Acme", source: "test" });
    const a = createContact({ name: "Ada Lovelace" });
    const b = createContact({ name: "Ada Byron King" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });
    seedInteraction(a.id, seedContentItem());
    seedInteraction(b.id, seedContentItem());

    expect(findDuplicateContacts()).toEqual([]);
  });

  it("collapses a three-way duplicate into one candidate, not two merges", () => {
    const a = createContact({ name: "Sam Altman" });
    const b = createContact({ name: "Sam Altman" });
    const c = createContact({ name: "Sam Altman" });
    for (const contact of [a, b, c]) {
      createContactChannel({
        contactId: contact.id,
        channelType: "email",
        value: "sam@openai.com",
        source: "test",
      });
    }

    const candidates = findDuplicateContacts();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].members).toHaveLength(3);
    expect(candidates[0].secondaryContactIds).toHaveLength(2);
  });

  it("excludes a contact that a previous run already merged away", () => {
    const a = createContact({ name: "Sam Altman" });
    const b = createContact({ name: "Sam Altman" });
    createContactChannel({
      contactId: a.id,
      channelType: "email",
      value: "sam@openai.com",
      source: "test",
    });
    createContactChannel({
      contactId: b.id,
      channelType: "email",
      value: "sam@openai.com",
      source: "test",
    });
    expect(findDuplicateContacts()).toHaveLength(1);

    mergeContacts({ primaryContactId: a.id, secondaryContactIds: [b.id] });

    // The tombstone is archived, so detection must not re-propose the pair.
    expect(findDuplicateContacts()).toEqual([]);
  });

  it("honours the tier filter", () => {
    const org = createOrg({ name: "NVIDIA", source: "test" });
    const a = createContact({ name: "Jim Fan" });
    const b = createContact({ name: "Jim Fan" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });

    expect(findDuplicateContacts({ tiers: [2] })).toHaveLength(1);
    expect(findDuplicateContacts({ tiers: [1] })).toEqual([]);
  });

  it("honours minConfidence and limit", () => {
    const org = createOrg({ name: "Acme", source: "test" });
    const a = createContact({ name: "Ada Lovelace" });
    const b = createContact({ name: "Ada Byron King" });
    createContactEmployment({ contactId: a.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: b.id, orgId: org.id, source: "test" });
    const thread = seedContentItem();
    seedInteraction(a.id, thread);
    seedInteraction(b.id, thread);

    expect(findDuplicateContacts({ minConfidence: 0.9 })).toEqual([]);
    expect(findDuplicateContacts({ minConfidence: 0.5 })).toHaveLength(1);
    expect(findDuplicateContacts({ limit: 0 })).toEqual([]);
  });

  it("scopes detection to the given contact ids", () => {
    const a = createContact({ name: "Sam Altman" });
    const b = createContact({ name: "Sam Altman" });
    for (const contact of [a, b]) {
      createContactChannel({
        contactId: contact.id,
        channelType: "email",
        value: "sam@openai.com",
        source: "test",
      });
    }

    expect(findDuplicateContacts({ contactIds: [a.id] })).toEqual([]);
    expect(findDuplicateContacts({ contactIds: [a.id, b.id] })).toHaveLength(1);
  });

  it("picks the survivor by enrichment score, then identity count, then age", () => {
    const org = createOrg({ name: "NVIDIA", source: "test" });
    const older = createContact({ name: "Jim Fan" });
    const richer = createContact({ name: "Jim Fan" });
    createContactEmployment({ contactId: older.id, orgId: org.id, source: "test" });
    createContactEmployment({ contactId: richer.id, orgId: org.id, source: "test" });
    setEnrichmentScore(older.id, 10);
    setEnrichmentScore(richer.id, 80);

    const [candidate] = findDuplicateContacts();
    expect(candidate.primaryContactId).toBe(richer.id);
    expect(candidate.secondaryContactIds).toEqual([older.id]);
  });
});

describe("pickPrimary", () => {
  const base = { name: "Ada", enrichmentScore: 0, identityCount: 0, createdAt: 100 };

  it("prefers the highest enrichment score", () => {
    expect(
      pickPrimary([
        { ...base, contactId: "a", enrichmentScore: 10 },
        { ...base, contactId: "b", enrichmentScore: 40 },
      ]),
    ).toBe("b");
  });

  it("falls back to the most linked identities", () => {
    expect(
      pickPrimary([
        { ...base, contactId: "a", identityCount: 1 },
        { ...base, contactId: "b", identityCount: 3 },
      ]),
    ).toBe("b");
  });

  it("falls back to the oldest record", () => {
    expect(
      pickPrimary([
        { ...base, contactId: "a", createdAt: 500 },
        { ...base, contactId: "b", createdAt: 100 },
      ]),
    ).toBe("b");
  });

  it("is deterministic when every rule ties", () => {
    const members = [
      { ...base, contactId: "b" },
      { ...base, contactId: "a" },
    ];
    expect(pickPrimary(members)).toBe("a");
    expect(pickPrimary([...members].reverse())).toBe("a");
  });
});
