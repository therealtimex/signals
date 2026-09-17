import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
import { ensureContactChannel } from "@/lib/db/queries/contact-channel-writes";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { getOrgRelationshipSummary } from "./org-relationships";
import { resetCoreTables } from "@/test/db";

describe("company relationship summary", () => {
  beforeEach(() => resetCoreTables());

  it("distinguishes known strength from no data and reports denominator-based coverage", () => {
    const owner = createContact({ name: "Owner", isSelf: true });
    const known = createContact({ name: "Known" });
    const unknown = createContact({ name: "Unknown" });
    const org = createOrg({ name: "Relationships Co" });
    for (const contact of [known, unknown]) {
      createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    }
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: known.id,
      edgeType: "relationship",
      weight: 80,
      scope: "shared",
      source: "test",
    });
    logInteraction({
      contactId: known.id,
      orgId: org.id,
      interactionType: "meeting",
      occurredAt: Math.floor(Date.now() / 1000) - 3 * 86_400,
      scope: "shared",
      source: "test",
    });

    const summary = getOrgRelationshipSummary(org.id);
    expect(summary.people).toMatchObject({ current: 2 });
    expect(summary.coverage.withRelationship).toBe(1);
    expect(summary.strength).toMatchObject({ strong: 1, unknown: 1 });
    expect(summary.paths[0]).toMatchObject({ target: { contactId: known.id } });
  });

  it("counts only verified company-domain channels in current-employee email coverage", () => {
    const org = createOrg({ name: "Coverage Co", domain: "coverage.example" });
    const workEmail = createContact({ name: "Work Email" });
    const personalEmail = createContact({ name: "Personal Email" });
    for (const contact of [workEmail, personalEmail]) {
      createContactEmployment({ contactId: contact.id, orgId: org.id, source: "test" });
    }
    ensureContactChannel({
      contactId: workEmail.id,
      channelType: "email",
      value: "work@coverage.example",
      isVerified: true,
      source: "test",
    });
    ensureContactChannel({
      contactId: personalEmail.id,
      channelType: "email",
      value: "personal@gmail.example",
      isVerified: true,
      source: "test",
    });

    const summary = getOrgRelationshipSummary(org.id);
    expect(summary.coverage.withEmail).toBe(2);
    expect(summary.coverage.withVerifiedEmail).toBe(1);
    expect(summary.coverage.email).toEqual({ verified: 1, total: 2 });
  });
});
