import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contactChannels, contactIdentities } from "@/lib/db/schema";
import { calculateEnrichmentScore } from "@/lib/db/enrichment";

/** Recalculate and persist enrichment score for a contact. */
export function recalcContactEnrichment(contactId: string): void {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;

  const identities = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all();

  const channels = db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId))
    .all();

  const score = calculateEnrichmentScore(contact, identities, channels);
  db.update(contacts)
    .set({ enrichmentScore: score, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(contacts.id, contactId))
    .run();
}
