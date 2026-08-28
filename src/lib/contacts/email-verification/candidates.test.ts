import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactChannels, contactEmailCandidates } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { updateEmailCandidate } from "./candidates";
import { resetCoreTables } from "@/test/db";

describe("email candidate verification", () => {
  beforeEach(() => resetCoreTables());

  it("promotes an explicitly verified prediction exactly once", () => {
    const org = createOrg({ name: "Verify Co", domain: "verify.example" });
    const contact = createContact({ name: "Ada Lovelace" });
    const id = nanoid();
    db.insert(contactEmailCandidates).values({
      id, contactId: contact.id, orgId: org.id,
      address: "ada.lovelace@verify.example",
      addressNormalized: "ada.lovelace@verify.example",
      pattern: "{first}.{last}", status: "predicted", confidence: "high",
      source: "enrich:email_pattern",
    }).run();

    expect(updateEmailCandidate(id, { action: "verify" })).toMatchObject({ status: "verified" });
    updateEmailCandidate(id, { action: "verify" });
    expect(db.select().from(contactChannels).all()).toMatchObject([
      { valueNormalized: "ada.lovelace@verify.example", isVerified: true },
    ]);
  });
});
