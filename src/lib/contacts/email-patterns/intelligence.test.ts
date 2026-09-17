import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactEmailCandidates, orgEmailPatterns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { ensureContactChannel } from "@/lib/db/queries/contact-channel-writes";
import {
  generateOrgEmailCandidates,
  getOrgEmailIntelligence,
  inferOrgEmailPatterns,
} from "./intelligence";
import { resetCoreTables } from "@/test/db";

describe("company email intelligence", () => {
  beforeEach(() => resetCoreTables());

  it("infers a high-confidence pattern from verified employee emails", () => {
    const org = createOrg({ name: "Pattern Co", domain: "pattern.example" });
    for (const [name, email] of [
      ["Ada Lovelace", "ada.lovelace@pattern.example"],
      ["Grace Hopper", "grace.hopper@pattern.example"],
      ["Alan Turing", "alan.turing@pattern.example"],
      ["Linus Torvalds", "ltorvalds@pattern.example"],
    ]) {
      const contact = createContact({ name });
      createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
      ensureContactChannel({
        contactId: contact.id,
        channelType: "email",
        value: email,
        isVerified: true,
        source: "manual",
      });
    }
    const result = inferOrgEmailPatterns(org.id);
    expect(result.patterns[0]).toMatchObject({
      pattern: "{first}.{last}",
      confidence: "high",
      matchCount: 3,
      sampleCount: 4,
      isSelected: true,
    });
  });

  it("counts verified email-pattern enrichment channels as inference samples", () => {
    const org = createOrg({ name: "Anchor Co", domain: "anchor.example" });
    const contact = createContact({ name: "Robert Taylor" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    ensureContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "robert@anchor.example",
      isVerified: true,
      source: "enrich:email_pattern",
    });

    const result = inferOrgEmailPatterns(org.id);
    expect(result.patterns[0]).toMatchObject({
      pattern: "{first}",
      matchCount: 1,
      sampleCount: 1,
    });
  });

  it("decays a protected pattern after its verified evidence disappears", () => {
    const org = createOrg({ name: "Decay Co", domain: "decay.example" });
    const channels = ["Ada Lovelace", "Grace Hopper", "Alan Turing"].map((name) => {
      const contact = createContact({ name });
      createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
      const [first, last] = name.toLowerCase().split(" ");
      return ensureContactChannel({
        contactId: contact.id,
        channelType: "email",
        value: `${first}.${last}@decay.example`,
        isVerified: true,
        source: "manual",
      });
    });
    db.insert(orgEmailPatterns).values({
      id: nanoid(), orgId: org.id, pattern: "{first}.{last}", rank: 1,
      confidence: "low", score: 0, matchCount: 0, sampleCount: 0,
      isSelected: true, source: "manual:override", evaluatedAt: 1,
    }).run();

    inferOrgEmailPatterns(org.id);
    expect(db.select().from(orgEmailPatterns).all()[0]).toMatchObject({
      confidence: "high",
      matchCount: 3,
      sampleCount: 3,
    });

    for (const channel of channels) {
      ensureContactChannel({
        contactId: channel.contactId,
        channelType: "email",
        value: channel.value,
        isVerified: false,
        source: channel.source,
      });
    }
    inferOrgEmailPatterns(org.id);

    expect(db.select().from(orgEmailPatterns).all()).toEqual([
      expect.objectContaining({
        pattern: "{first}.{last}",
        source: "manual:override",
        confidence: "low",
        score: 0,
        matchCount: 0,
        sampleCount: 0,
        evidence: "[]",
      }),
    ]);
  });

  it("generates predictions separately from real contact channels", () => {
    const org = createOrg({ name: "Candidate Co", domain: "candidate.example" });
    const contact = createContact({ name: "Ludwig van der Berg" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    db.insert(orgEmailPatterns).values({
      id: nanoid(), orgId: org.id, pattern: "{first}.{last}", rank: 1,
      confidence: "high", score: 1, matchCount: 3, sampleCount: 3,
      isSelected: true, source: "manual:override", evaluatedAt: 1,
    }).run();

    expect(generateOrgEmailCandidates(org.id)).toMatchObject({ created: 1 });
    expect(db.select().from(contactEmailCandidates).all()[0]).toMatchObject({
      address: "ludwig.vanderberg@candidate.example",
      status: "predicted",
      confidence: "medium",
    });
    expect(contact.channels).toHaveLength(0);
  });

  it("reports the ladder level, verified anchors, and candidate domain mismatches", () => {
    const org = createOrg({ name: "Ladder Co", domain: "ladder.example" });
    const contact = createContact({ name: "Ladder Person" });
    createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    db.insert(orgEmailPatterns).values({
      id: nanoid(), orgId: org.id, pattern: "{first}", rank: 1,
      confidence: "low", score: 1, matchCount: 1, sampleCount: 1,
      isSelected: true, source: "manual:override", evaluatedAt: 1,
    }).run();
    db.insert(contactEmailCandidates).values({
      id: nanoid(), contactId: contact.id, orgId: org.id,
      address: "ladder@mail.ladder.example", addressNormalized: "ladder@mail.ladder.example",
      status: "verified", confidence: "low", source: "test",
    }).run();
    db.insert(contactEmailCandidates).values({
      id: nanoid(), contactId: contact.id, orgId: org.id,
      address: "ladder@gmail.com", addressNormalized: "ladder@gmail.com",
      status: "verified", confidence: "low", source: "test",
    }).run();

    expect(getOrgEmailIntelligence(org.id)).toMatchObject({
      ladder: { level: "L2", label: "L2 · Predictions only" },
      verifiedAnchorCount: 0,
      domainMismatches: ["mail.ladder.example"],
    });

    ensureContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "ladder@ladder.example",
      isVerified: true,
      source: "import:test",
    });
    expect(getOrgEmailIntelligence(org.id)).toMatchObject({
      ladder: { level: "L3", label: "L3 · Anchored" },
      verifiedAnchorCount: 1,
    });
  });
});
