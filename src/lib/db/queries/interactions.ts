import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { interactions } from "@/lib/db/schema";
import type { Interaction, NewInteraction } from "@/lib/db/types";

export type LogInteractionInput = {
  contactId: string;
  interactionType: string;
  occurredAt?: number;
  orgId?: string | null;
  direction?: "inbound" | "outbound" | "mutual" | null;
  summary?: string | null;
  isMeaningful?: boolean;
  scope?: "shared" | "local_only";
  source?: string;
  contentItemId?: string | null;
  metadata?: Record<string, unknown>;
};

export function logInteraction(input: LogInteractionInput): Interaction {
  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const values: NewInteraction = {
    id,
    contactId: input.contactId,
    orgId: input.orgId ?? null,
    interactionType: input.interactionType,
    direction: input.direction ?? null,
    summary: input.summary ?? null,
    isMeaningful: input.isMeaningful ?? false,
    occurredAt: input.occurredAt ?? now,
    scope: input.scope ?? "local_only",
    source: input.source ?? "agent",
    engagementId: null,
    contentItemId: input.contentItemId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
  };

  db.insert(interactions).values(values).run();
  return db.select().from(interactions).where(eq(interactions.id, id)).get()!;
}
