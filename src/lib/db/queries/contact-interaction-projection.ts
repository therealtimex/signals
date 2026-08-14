import { eq, max } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, interactions } from "@/lib/db/schema";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Bump `contacts.lastInteractionAt` when a newer interaction timestamp is known. */
export function touchContactLastInteraction(contactId: string, occurredAt: number): void {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;

  if (!contact.lastInteractionAt || occurredAt > contact.lastInteractionAt) {
    db.update(contacts)
      .set({
        lastInteractionAt: occurredAt,
        updatedAt: nowUnix(),
      })
      .where(eq(contacts.id, contactId))
      .run();
  }
}

/** Recompute projection from the interactions log (max occurred_at). */
export function recomputeContactLastInteraction(contactId: string): number | null {
  const row = db
    .select({ latest: max(interactions.occurredAt) })
    .from(interactions)
    .where(eq(interactions.contactId, contactId))
    .get();

  const latest = row?.latest ?? null;
  if (latest === null) return null;

  db.update(contacts)
    .set({
      lastInteractionAt: latest,
      updatedAt: nowUnix(),
    })
    .where(eq(contacts.id, contactId))
    .run();

  return latest;
}
