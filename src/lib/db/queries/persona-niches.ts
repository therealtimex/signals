import { and, eq } from "drizzle-orm";
import { nicheSlugFromName } from "@/lib/db/niche-slug";
import { db } from "@/lib/db/client";
import { graphEdges } from "@/lib/db/schema";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { ensureNicheByName, getNicheBySlug } from "@/lib/db/queries/niches";
import type { ContactPersona } from "@/lib/db/types";

export const PERSONA_INTEREST_BACKFILL_SOURCE = "backfill:persona-interests";

/** True when an existing edge was written by the same projection caller/family and may be updated. */
export function isProjectionOwnedEdgeSource(
  edgeSource: string | null | undefined,
  callerSource: string,
): boolean {
  if (edgeSource == null) return false;
  if (edgeSource === callerSource) return true;
  if (callerSource.startsWith("persona:") && edgeSource.startsWith("persona:")) return true;
  if (
    callerSource === PERSONA_INTEREST_BACKFILL_SOURCE &&
    edgeSource === PERSONA_INTEREST_BACKFILL_SOURCE
  ) {
    return true;
  }
  return false;
}

export function shouldPreserveIndependentEdgeSource(
  edgeSource: string | null | undefined,
  callerSource: string,
): boolean {
  return !isProjectionOwnedEdgeSource(edgeSource, callerSource);
}

function existingBelongsToNicheEdge(contactId: string, nicheId: string) {
  return db
    .select({ source: graphEdges.source })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "niche"),
        eq(graphEdges.dstId, nicheId),
      ),
    )
    .get();
}

/** Project persona interests into niche membership edges (additive only; inherits persona scope). */
export function projectPersonaInterestsToNiches(
  persona: ContactPersona,
  source: string,
): { edgesUpserted: number; nichesCreated: number } {
  const scope = persona.scope === "local_only" ? "local_only" : "shared";
  let interests: string[] = [];
  try {
    interests = JSON.parse(persona.interests ?? "[]") as string[];
  } catch {
    return { edgesUpserted: 0, nichesCreated: 0 };
  }

  let edgesUpserted = 0;
  let nichesCreated = 0;
  for (const interest of interests) {
    if (!interest || typeof interest !== "string") continue;
    const trimmed = interest.trim();
    if (!trimmed) continue;

    const slug = nicheSlugFromName(trimmed);
    if (!slug) continue;

    const existed = Boolean(getNicheBySlug(slug));
    const niche = ensureNicheByName(trimmed, {
      source,
      nicheType: "interest",
      scope,
    });
    if (!existed) nichesCreated++;

    const existingEdge = existingBelongsToNicheEdge(persona.contactId, niche.id);
    const preserveIndependentSource =
      existingEdge != null &&
      shouldPreserveIndependentEdgeSource(existingEdge.source, source);

    upsertGraphEdge({
      srcType: "contact",
      srcId: persona.contactId,
      dstType: "niche",
      dstId: niche.id,
      edgeType: "belongs_to_niche",
      weight: preserveIndependentSource ? undefined : (persona.confidence ?? undefined),
      scope: preserveIndependentSource ? undefined : scope,
      source: preserveIndependentSource ? undefined : source,
    });
    edgesUpserted++;
  }

  return { edgesUpserted, nichesCreated };
}
