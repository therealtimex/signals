import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createOrg } from "@/lib/db/queries/orgs";
import { createContactEmployment } from "@/lib/db/queries/contact-employments";
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
});
