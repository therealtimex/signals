import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { logInteraction } from "@/lib/db/queries/interactions";
import {
  getContactRelationship,
  upsertContactRelationship,
} from "@/lib/db/queries/contact-relationship";
import { db } from "@/lib/db/client";
import { contacts, graphEdges } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("contact relationship", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("upserts local_only relationship metadata for owner and contact", () => {
    const owner = createContact({ name: "Owner" });
    db.update(contacts).set({ isSelf: true }).where(eq(contacts.id, owner.id)).run();
    const subject = createContact({ name: "Subject" });

    const saved = upsertContactRelationship({
      contactId: subject.id,
      stage: "warm",
      warmth: 72,
      notes: "Met at conference",
      relationshipType: "professional",
    });

    expect(saved.stage).toBe("warm");
    expect(saved.warmth).toBe(72);
    expect(saved.notes).toBe("Met at conference");

    const edge = db.select().from(graphEdges).get();
    expect(edge?.scope).toBe("local_only");
    expect(edge?.edgeType).toBe("relationship");
    expect(getContactRelationship(subject.id)?.stage).toBe("warm");
  });

  it("bumps last_meaningful_interaction when logging a meaningful interaction", () => {
    const owner = createContact({ name: "Owner" });
    db.update(contacts).set({ isSelf: true }).where(eq(contacts.id, owner.id)).run();
    const subject = createContact({ name: "Subject" });

    logInteraction({
      contactId: subject.id,
      interactionType: "meeting",
      isMeaningful: true,
      occurredAt: 1_700_000_000,
      source: "test",
    });

    const relationship = getContactRelationship(subject.id);
    expect(relationship?.lastMeaningfulInteraction).toBe(1_700_000_000);
  });
});
