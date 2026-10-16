import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { browserConnectionOrigins } from "@/lib/db/schema";
import type { BrowserConnectionOrigin } from "@/lib/db/types";

export type BrowserConnectionOriginSource = BrowserConnectionOrigin["source"];

/**
 * Websites the user added to one browser connection, newest first. Origins are stored
 * normalized (ADR-547-4/5); callers normalize before writing.
 */
export function listConnectionOrigins(connectionId: string): BrowserConnectionOrigin[] {
  return db
    .select()
    .from(browserConnectionOrigins)
    .where(eq(browserConnectionOrigins.connectionId, connectionId))
    // created_at has one-second resolution; rowid keeps insertion order within a second.
    .orderBy(desc(browserConnectionOrigins.createdAt), desc(sql`rowid`))
    .all();
}

/** Idempotent on (connection, origin): a second add keeps the first row and reports `created: false`. */
export function addConnectionOrigin(input: {
  connectionId: string;
  origin: string;
  source: BrowserConnectionOriginSource;
}): { created: boolean; row: BrowserConnectionOrigin } {
  const inserted = db
    .insert(browserConnectionOrigins)
    .values({
      id: `bco_${nanoid()}`,
      connectionId: input.connectionId,
      origin: input.origin,
      source: input.source,
    })
    .onConflictDoNothing({
      target: [browserConnectionOrigins.connectionId, browserConnectionOrigins.origin],
    })
    .returning()
    .get();
  if (inserted) return { created: true, row: inserted };

  const existing = db
    .select()
    .from(browserConnectionOrigins)
    .where(
      and(
        eq(browserConnectionOrigins.connectionId, input.connectionId),
        eq(browserConnectionOrigins.origin, input.origin),
      ),
    )
    .get();
  if (!existing) throw new Error(`Could not add ${input.origin} to ${input.connectionId}`);
  return { created: false, row: existing };
}

export function removeConnectionOrigin(connectionId: string, origin: string): boolean {
  const result = db
    .delete(browserConnectionOrigins)
    .where(
      and(
        eq(browserConnectionOrigins.connectionId, connectionId),
        eq(browserConnectionOrigins.origin, origin),
      ),
    )
    .run();
  return result.changes > 0;
}
