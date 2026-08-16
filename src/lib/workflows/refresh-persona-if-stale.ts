import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import { getActivePersona } from "@/lib/db/queries/personas";
import { isPersonaStale } from "@/lib/persona/staleness";
import {
  generatePersona,
  type GeneratePersonaOptions,
  type GeneratePersonaResult,
} from "@/lib/workflows/generate-persona";

export type RefreshPersonaIfStaleSkippedReason = "no_persona" | "local_only" | "fresh";

export type RefreshPersonaIfStaleResult =
  | {
      refreshed: false;
      skipped: true;
      reason: RefreshPersonaIfStaleSkippedReason;
      personaId?: string;
    }
  | ({ refreshed: true } & Extract<GeneratePersonaResult, { generated: true }>)
  | ({ refreshed: false; skipped: true } & Extract<
      GeneratePersonaResult,
      { generated: false; reason: "evidence_unchanged" }
    >);

export type RefreshPersonaIfStaleOptions = Omit<GeneratePersonaOptions, "force"> & {
  now?: number;
};

/**
 * Assembles evidence (no LLM) and regenerates only when hash drifted or age exceeded.
 * Skips persona-less contacts and active local_only personas without calling generatePersona.
 */
export async function refreshPersonaIfStale(
  contactId: string,
  opts?: RefreshPersonaIfStaleOptions,
): Promise<RefreshPersonaIfStaleResult> {
  const contact = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const activePersona = getActivePersona(contactId, { includeLocalOnly: true });
  if (!activePersona) {
    return { refreshed: false, skipped: true, reason: "no_persona" };
  }
  if (activePersona.scope === "local_only") {
    return { refreshed: false, skipped: true, reason: "local_only", personaId: activePersona.id };
  }

  const bundle = assemblePersonaEvidence(contactId);
  const { stale, ageStale } = isPersonaStale({
    generatedAt: activePersona.generatedAt,
    sourceWindow: activePersona.sourceWindow,
    evidenceHash: bundle.provenance.evidenceHash,
    now: opts?.now,
  });

  if (!stale) {
    return {
      refreshed: false,
      skipped: true,
      reason: "fresh",
      personaId: activePersona.id,
    };
  }

  const result = await generatePersona(contactId, {
    ...opts,
    trigger: opts?.trigger ?? "scheduled",
    force: ageStale,
  });

  if (!result.generated) {
    return { refreshed: false, ...result };
  }

  return { refreshed: true, ...result };
}
