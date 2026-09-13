import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contentItems } from "@/lib/db/schema";
import type { PublicSnowballSourceEnvelope } from "@/lib/workflows/snowball-sources/types";

export function snowballSourceContentItemId(canonicalUrl: string): string {
  return `source_${createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24)}`;
}

/** Idempotently persist the bounded evidence envelope, never the fetched document. */
export function upsertPublicSnowballSource(source: PublicSnowballSourceEnvelope): string {
  const id = snowballSourceContentItemId(source.canonicalUrl);
  const now = Math.floor(Date.now() / 1000);
  const values = {
    id,
    title: source.title,
    body: source.facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n").slice(0, 8_000),
    contentType: "article" as const,
    platformTarget: source.canonicalUrl,
    status: "imported" as const,
    aiGenerated: false,
    origin: "imported" as const,
    direction: "inbound" as const,
    platformData: JSON.stringify({ source }),
    updatedAt: now,
  };
  db.insert(contentItems).values(values).onConflictDoUpdate({
    target: contentItems.id,
    set: {
      title: values.title,
      body: values.body,
      platformTarget: values.platformTarget,
      platformData: values.platformData,
      updatedAt: now,
    },
  }).run();
  return db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, id)).get()!.id;
}
