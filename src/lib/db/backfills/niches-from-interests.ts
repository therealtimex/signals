import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactPersonas, niches } from "@/lib/db/schema";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { ensureNicheByName, getNicheBySlug } from "@/lib/db/queries/niches";
import { nicheSlugFromName } from "@/lib/db/niche-slug";

const SOURCE = "backfill:persona-interests";

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
    let interests: string[] = [];
    try {
      interests = JSON.parse(persona.interests ?? "[]") as string[];
    } catch {
      continue;
    }

    for (const interest of interests) {
      if (!interest || typeof interest !== "string") continue;
      const trimmed = interest.trim();
      if (!trimmed) continue;

      const slug = nicheSlugFromName(trimmed);
      const existed = Boolean(getNicheBySlug(slug));

      const niche = ensureNicheByName(trimmed, {
        source: SOURCE,
        nicheType: "interest",
        scope: persona.scope,
      });

      if (!existed) {
        nichesCreated++;
      }

      upsertGraphEdge({
        srcType: "contact",
        srcId: persona.contactId,
        dstType: "niche",
        dstId: niche.id,
        edgeType: "belongs_to_niche",
        weight: persona.confidence ?? undefined,
        scope: persona.scope,
        source: SOURCE,
      });
      edgesUpserted++;
    }
  }

  return { nichesCreated, edgesUpserted };
}
