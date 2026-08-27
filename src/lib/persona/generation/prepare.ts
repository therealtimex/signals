import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assemblePersonaEvidence, type PersonaEvidenceBundle } from "@/lib/db/queries/persona-evidence";
import { PersonaScopeError } from "@/lib/db/queries/persona-errors";
import { getActivePersona, type SerializedContactPersona } from "@/lib/db/queries/personas";
import { contacts } from "@/lib/db/schema";

export type PreparedPersonaGeneration =
  | {
      kind: "skip";
      reason: "evidence_unchanged";
      personaId: string;
    }
  | {
      kind: "ready";
      activePersona: SerializedContactPersona | null;
      bundle: PersonaEvidenceBundle;
    };

function parseSourceWindow(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function preparePersonaGeneration(
  contactId: string,
  opts?: { force?: boolean },
): PreparedPersonaGeneration {
  const contact = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const activePersona = getActivePersona(contactId, { includeLocalOnly: true }) ?? null;
  if (activePersona?.scope === "local_only") {
    throw new PersonaScopeError(
      "Cannot generate a shared persona while an active local_only persona exists — re-scope via upsert_persona first",
    );
  }

  const bundle = assemblePersonaEvidence(contactId);
  if (
    !opts?.force &&
    activePersona &&
    parseSourceWindow(activePersona.sourceWindow).evidenceHash === bundle.provenance.evidenceHash
  ) {
    return {
      kind: "skip",
      reason: "evidence_unchanged",
      personaId: activePersona.id,
    };
  }

  return { kind: "ready", activePersona, bundle };
}
