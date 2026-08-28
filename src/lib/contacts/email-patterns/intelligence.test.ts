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
});
