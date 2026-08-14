import { and, eq, like, desc, count, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { graphEdges, niches } from "@/lib/db/schema";
import { nicheSlugFromName } from "@/lib/db/niche-slug";
import type { Niche, PaginatedResult } from "@/lib/db/types";

export type NicheWithMemberCount = Niche & { memberCount: number };

export function listNiches(opts?: {
  search?: string;
  status?: Niche["status"];
  page?: number;
  pageSize?: number;
  includeLocalOnly?: boolean;
}): PaginatedResult<NicheWithMemberCount> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(niches.scope, "shared"));
  }
  if (opts?.status) {
    conditions.push(eq(niches.status, opts.status));
  }
  if (opts?.search) {
    conditions.push(like(niches.name, `%${opts.search}%`));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ value: count() }).from(niches).where(where).get()?.value ?? 0;

  const rows = db
    .select()
    .from(niches)
    .where(where)
    .orderBy(desc(niches.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const data = rows.map((niche) => ({
    ...niche,
    memberCount: countNicheMembers(niche.id, {
      includeLocalOnly: opts?.includeLocalOnly,
    }),
  }));

  return { data, total };
}

export function getNicheById(id: string): Niche | undefined {
  return db.select().from(niches).where(eq(niches.id, id)).get();
}

export function getNicheBySlug(slug: string): Niche | undefined {
  return db.select().from(niches).where(eq(niches.slug, slug)).get();
}

/** Find or create a niche by normalized slug. */
export function ensureNicheByName(
  name: string,
  opts?: {
    source?: string;
    nicheType?: Niche["nicheType"];
    scope?: Niche["scope"];
  },
): Niche {
  const displayName = name.trim();
  const slug = nicheSlugFromName(displayName);
  if (!slug) {
    throw new Error("Niche name must contain at least one alphanumeric character");
  }

  const existing = getNicheBySlug(slug);
  if (existing) return existing;

  const id = nanoid();
  db.insert(niches)
    .values({
      id,
      name: displayName,
      slug,
      nicheType: opts?.nicheType ?? "interest",
      source: opts?.source ?? "manual",
      scope: opts?.scope ?? "shared",
    })
    .run();

  return db.select().from(niches).where(eq(niches.id, id)).get()!;
}

export type UpsertNicheInput = {
  id?: string;
  name: string;
  description?: string | null;
  nicheType?: Niche["nicheType"];
  status?: Niche["status"];
  scope?: Niche["scope"];
  source?: string;
  metadata?: Record<string, unknown>;
};

export function upsertNiche(input: UpsertNicheInput): Niche {
  const slug = nicheSlugFromName(input.name);
  if (!slug) {
    throw new Error("Niche name must contain at least one alphanumeric character");
  }

  const now = Math.floor(Date.now() / 1000);

  if (input.id) {
    const existing = getNicheById(input.id);
    if (!existing) {
      throw new Error(`Niche not found: ${input.id}`);
    }

    db.update(niches)
      .set({
        name: input.name.trim(),
        slug,
        description: input.description ?? existing.description,
        nicheType: input.nicheType ?? existing.nicheType,
        status: input.status ?? existing.status,
        scope: input.scope ?? existing.scope,
        source: input.source ?? existing.source,
        metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata,
        updatedAt: now,
      })
      .where(eq(niches.id, input.id))
      .run();

    return getNicheById(input.id)!;
  }

  const bySlug = getNicheBySlug(slug);
  if (bySlug) {
    return upsertNiche({ ...input, id: bySlug.id });
  }

  const id = nanoid();
  db.insert(niches)
    .values({
      id,
      name: input.name.trim(),
      slug,
      description: input.description ?? null,
      nicheType: input.nicheType ?? "interest",
      status: input.status ?? "active",
      scope: input.scope ?? "shared",
      source: input.source ?? "agent",
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .run();

  return getNicheById(id)!;
}

/** Count belongs_to_niche edges pointing at this niche (shared scope by default). */
export function countNicheMembers(
  nicheId: string,
  opts?: { includeLocalOnly?: boolean },
): number {
  const conditions: SQL[] = [
    eq(graphEdges.edgeType, "belongs_to_niche"),
    eq(graphEdges.dstType, "niche"),
    eq(graphEdges.dstId, nicheId),
  ];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(graphEdges.scope, "shared"));
  }

  return (
    db
      .select({ value: count() })
      .from(graphEdges)
      .where(and(...conditions))
      .get()?.value ?? 0
  );
}
