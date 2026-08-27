import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
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

export function getPersonaByWorkflowRunId(
  workflowRunId: string,
): SerializedContactPersona | undefined {
  return db
    .select()
    .from(contactPersonas)
    .where(eq(contactPersonas.workflowRunId, workflowRunId))
    .orderBy(desc(contactPersonas.generatedAt), desc(sql`rowid`))
    .get();
}

function upsertPersonaWithRunner(
  runner: DbRunner,
  input: UpsertPersonaInput,
  now: number,
  id: string,
): ContactPersona {
  const active = runner
    .select()
    .from(contactPersonas)
    .where(
      and(eq(contactPersonas.contactId, input.contactId), eq(contactPersonas.status, "active")),
    )
    .get();

  const merged = {
    archetype: input.archetype !== undefined ? (input.archetype ?? null) : (active?.archetype ?? null),
    tone: input.tone !== undefined ? (input.tone ?? null) : (active?.tone ?? null),
    summary: input.summary !== undefined ? (input.summary ?? null) : (active?.summary ?? null),
    description:
      input.description !== undefined ? (input.description ?? null) : (active?.description ?? null),
    interests:
      input.interests !== undefined
        ? input.interests
        : JSON.parse(active?.interests ?? "[]") as string[],
    conversionTriggers:
      input.conversionTriggers !== undefined
        ? input.conversionTriggers
        : (JSON.parse(active?.conversionTriggers ?? "[]") as string[]),
    engagementFormats:
      input.engagementFormats !== undefined
        ? input.engagementFormats
        : (JSON.parse(active?.engagementFormats ?? "[]") as string[]),
    confidence:
      input.confidence !== undefined ? (input.confidence ?? null) : (active?.confidence ?? null),
    scope: input.scope ?? active?.scope ?? "shared",
    model: input.model !== undefined ? (input.model ?? null) : (active?.model ?? null),
    sourceWindow:
      input.sourceWindow !== undefined
        ? input.sourceWindow
        : (JSON.parse(active?.sourceWindow ?? "{}") as Record<string, unknown>),
    workflowRunId:
      input.workflowRunId !== undefined
        ? (input.workflowRunId ?? null)
        : (active?.workflowRunId ?? null),
  };

  if (active) {
    runner
      .update(contactPersonas)
      .set({
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      })
      .where(eq(contactPersonas.id, active.id))
      .run();
  }

  runner
    .insert(contactPersonas)
    .values({
      id,
      contactId: input.contactId,
      status: "active",
      archetype: merged.archetype,
      tone: merged.tone,
      summary: merged.summary,
      description: merged.description,
      interests: JSON.stringify(merged.interests),
      conversionTriggers: JSON.stringify(merged.conversionTriggers),
      engagementFormats: JSON.stringify(merged.engagementFormats),
      confidence: merged.confidence,
      scope: merged.scope,
      model: merged.model,
      sourceWindow: JSON.stringify(merged.sourceWindow),
      workflowRunId: merged.workflowRunId,
      generatedAt: now,
      supersededAt: null,
    })
    .run();

  return runner.select().from(contactPersonas).where(eq(contactPersonas.id, id)).get()!;
}

export function upsertPersona(
  input: UpsertPersonaInput,
  runner?: DbRunner,
): ContactPersona {
  const now = nowUnix();
  const id = nanoid();

  if (runner) {
    return upsertPersonaWithRunner(runner, input, now, id);
  }

  return db.transaction((tx) => upsertPersonaWithRunner(tx, input, now, id));
}
