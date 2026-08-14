import { eq, max } from "drizzle-orm";
import { db, type DbRunner } from "@/lib/db/client";
import { contacts, interactions } from "@/lib/db/schema";

/** Bump `contacts.lastInteractionAt` when a newer interaction timestamp is known. */
export function touchContactLastInteraction(
  contactId: string,
  occurredAt: number,
  runner: DbRunner = db,
): void {
  const contact = runner.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;

  if (!contact.lastInteractionAt || occurredAt > contact.lastInteractionAt) {
    runner
      .update(contacts)
      .set({
        lastInteractionAt: occurredAt,
        updatedAt: nowUnix(),
      })
      .where(eq(contacts.id, contactId))
      .run();
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
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
