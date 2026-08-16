import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactPersonas } from "@/lib/db/schema";
import {
  PERSONA_INTEREST_BACKFILL_SOURCE,
  projectPersonaInterestsToNiches,
} from "@/lib/db/queries/persona-niches";

/** Graduate persona interests JSON into niches + belongs_to_niche edges. */
export function backfillNichesFromInterests(): { nichesCreated: number; edgesUpserted: number } {
  const personas = db
    .select()
    .from(contactPersonas)
    .where(eq(contactPersonas.status, "active"))
    .all();

  let nichesCreated = 0;
  let edgesUpserted = 0;

  for (const persona of personas) {
    const result = projectPersonaInterestsToNiches(persona, PERSONA_INTEREST_BACKFILL_SOURCE);
    nichesCreated += result.nichesCreated;
    edgesUpserted += result.edgesUpserted;
  }

  return { nichesCreated, edgesUpserted };
}
