import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactPersonas } from "@/lib/db/schema";
import type { ContactPersona } from "@/lib/db/types";

export type SerializedContactPersona = ContactPersona;

export type UpsertPersonaInput = {
  contactId: string;
  archetype?: string | null;
  tone?: string | null;
  summary?: string | null;
  description?: string | null;
  interests?: string[];
  conversionTriggers?: string[];
  engagementFormats?: string[];
  confidence?: number | null;
  scope?: "shared" | "local_only";
  model?: string | null;
  sourceWindow?: Record<string, unknown>;
  workflowRunId?: string | null;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Get the active persona for a contact; filters local_only unless opted in. */
export function getActivePersona(
  contactId: string,
  opts?: { includeLocalOnly?: boolean },
): SerializedContactPersona | undefined {
  const persona = db
    .select()
    .from(contactPersonas)
    .where(and(eq(contactPersonas.contactId, contactId), eq(contactPersonas.status, "active")))
    .get();

  if (!persona) return undefined;
  if (!opts?.includeLocalOnly && persona.scope === "local_only") return undefined;
  return persona;
}

export function upsertPersona(input: UpsertPersonaInput): ContactPersona {
  const now = nowUnix();
  const id = nanoid();

  db.transaction((tx) => {
    const active = tx
      .select()
      .from(contactPersonas)
      .where(
        and(eq(contactPersonas.contactId, input.contactId), eq(contactPersonas.status, "active")),
      )
      .get();

    if (active) {
      tx.update(contactPersonas)
        .set({
          status: "superseded",
          supersededAt: now,
          updatedAt: now,
        })
        .where(eq(contactPersonas.id, active.id))
        .run();
    }

    tx.insert(contactPersonas)
      .values({
        id,
        contactId: input.contactId,
        status: "active",
        archetype: input.archetype ?? null,
        tone: input.tone ?? null,
        summary: input.summary ?? null,
        description: input.description ?? null,
        interests: JSON.stringify(input.interests ?? []),
        conversionTriggers: JSON.stringify(input.conversionTriggers ?? []),
        engagementFormats: JSON.stringify(input.engagementFormats ?? []),
        confidence: input.confidence ?? null,
        scope: input.scope ?? "shared",
        model: input.model ?? null,
        sourceWindow: JSON.stringify(input.sourceWindow ?? {}),
        workflowRunId: input.workflowRunId ?? null,
        generatedAt: now,
        supersededAt: null,
      })
      .run();
  });

  return db.select().from(contactPersonas).where(eq(contactPersonas.id, id)).get()!;
}
