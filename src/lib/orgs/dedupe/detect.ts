import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { graphEdges, orgs } from "@/lib/db/schema";
import { orgNameKey } from "@/lib/contacts/dedupe/normalize";

/**
 * Duplicate org detection (#442).
 *
 * `ensureOrgByName` dedupes on an exact case-folded key, which leaves one firm spread across
 * several records — "Andreessen Horowitz", "Andreessen Horowitz (a16z)" and "a16z" are three orgs
 * holding twelve people between them. That fragments the linked-people count the Companies list
 * sorts on, and gives every one of them a partial roster.
 *
 * Read-only by design. Merging orgs moves employment edges, so this surfaces candidates for review
 * rather than acting on them.
 */
/**
 * Two tiers, not three. A shared domain or platform identity would be the strongest possible
 * evidence, but the write path already refuses both — `Domain X is already assigned to another
 * company`, `Platform account X is already claimed by org Y` — so no such pair can exist to find.
 * Detecting an impossible state is dead code.
 */
export type OrgDuplicateTier = 1 | 2;

export interface OrgDuplicateMember {
  orgId: string;
  name: string;
  domain: string | null;
  contactCount: number;
  createdAt: number;
}

export interface OrgDuplicateCandidate {
  /** Suggested survivor: most linked people, then oldest. Callers may override. */
  primaryOrgId: string;
  secondaryOrgIds: string[];
  tier: OrgDuplicateTier;
  confidence: number;
  reason: string;
  members: OrgDuplicateMember[];
}

export interface FindDuplicateOrgsOptions {
  tiers?: OrgDuplicateTier[];
  minConfidence?: number;
  limit?: number;
}

/**
 * A single generic token ("World", "Stealth", "Angel") is a placeholder or a common word, not an
 * abbreviation of the longer name that contains it. Containment only counts as evidence once the
 * shorter name is specific enough to mean something on its own.
 */
const MIN_CONTAINED_TOKENS = 2;

/**
 * Industry descriptions, not company names. "Wing Venture Capital" and "Earth Venture Capital" both
 * contain "Venture Capital"; that says they are both VC firms, not that either is the other.
 */
const GENERIC_ORG_NAMES = new Set([
  "venture capital",
  "private equity",
  "asset management",
  "software",
  "consulting",
  "technology",
  "self employed",
  "freelance",
  "stealth startup",
]);

/**
 * Words that mark the longer name as a *different* legal or organizational entity rather than a
 * fuller rendering of the same one: a venture arm, a division, a country subsidiary. "Lockheed
 * Martin Ventures" is not "Lockheed Martin", and merging them would be wrong in a way that is
 * tedious to undo. Costs some true duplicates ("Acme" / "Acme Group"), which is the right trade —
 * a missed duplicate is untidy, a bad suggestion wastes the reviewer's judgement.
 */
const DISTINCT_ENTITY_TOKENS = new Set([
  "ventures",
  "venture",
  "group",
  "holdings",
  "partners",
  "partner",
  "capital",
  "center",
  "centre",
  "institute",
  "journal",
  "foundation",
  "labs",
  "lab",
  "studio",
  "studios",
  "academy",
  "school",
  "faculty",
  "university",
  "division",
  "subsidiary",
  "vietnam",
  "america",
  "asia",
  "europe",
  "global",
]);

/** "A / B" lists two organizations; it is not a longer rendering of either. */
function isDualAffiliationName(name: string): boolean {
  return /\s\/\s/.test(name);
}

interface OrgFacts {
  id: string;
  name: string;
  domain: string | null;
  createdAt: number;
  nameKey: string;
  contactCount: number;
}

function loadOrgFacts(): Map<string, OrgFacts> {
  const rows = db
    .select()
    .from(orgs)
    .where(sql`json_extract(${orgs.metadata}, '$.archived') IS NOT 1`)
    .all();

  const facts = new Map<string, OrgFacts>();
  for (const org of rows) {
    facts.set(org.id, {
      id: org.id,
      name: org.name,
      domain: org.domain,
      createdAt: org.createdAt,
      nameKey: orgNameKey(org.name),
      contactCount: 0,
    });
  }

  const counts = db
    .select({ orgId: graphEdges.dstId, total: sql<number>`COUNT(*)` })
    .from(graphEdges)
    .where(
      sql`${graphEdges.dstType} = 'org' AND ${graphEdges.srcType} = 'contact'
          AND ${graphEdges.edgeType} = 'works_at' AND ${graphEdges.scope} = 'shared'`,
    )
    .groupBy(graphEdges.dstId)
    .all();
  for (const row of counts) {
    const fact = facts.get(row.orgId);
    if (fact) fact.contactCount = Number(row.total);
  }

  return facts;
}

/** True when `short` is the leading or trailing token run of `long` — "acme" inside "acme labs". */
function isTokenContained(shortKey: string, longKey: string): boolean {
  if (!shortKey || !longKey || shortKey === longKey) return false;
  if (GENERIC_ORG_NAMES.has(shortKey)) return false;

  const short = shortKey.split(" ");
  const long = longKey.split(" ");
  if (short.length < MIN_CONTAINED_TOKENS || short.length >= long.length) return false;

  const head = long.slice(0, short.length).join(" ");
  const tail = long.slice(long.length - short.length).join(" ");
  if (head !== shortKey && tail !== shortKey) return false;

  const extra = head === shortKey ? long.slice(short.length) : long.slice(0, long.length - short.length);
  return !extra.some((token) => DISTINCT_ENTITY_TOKENS.has(token));
}

function evidenceFor(a: OrgFacts, b: OrgFacts): { tier: OrgDuplicateTier; confidence: number; reason: string } | null {
  if (a.nameKey && a.nameKey === b.nameKey) {
    return { tier: 1, confidence: 0.9, reason: "Identical normalized name" };
  }
  // "UC Berkeley / Physical Intelligence" names two affiliations, so containing "UC Berkeley" does
  // not make it the same record. `orgNameKey` folds the slash away, so this reads the raw name.
  const dualAffiliation = isDualAffiliationName(a.name) || isDualAffiliationName(b.name);
  if (!dualAffiliation && (isTokenContained(a.nameKey, b.nameKey) || isTokenContained(b.nameKey, a.nameKey))) {
    return { tier: 2, confidence: 0.6, reason: "One name contains the other" };
  }
  return null;
}

/** Most linked people wins; ties break to the oldest record, which usually has the richer history. */
function pickPrimary(members: OrgFacts[]): OrgFacts {
  return [...members].sort((a, b) => {
    if (b.contactCount !== a.contactCount) return b.contactCount - a.contactCount;
    return a.createdAt - b.createdAt;
  })[0]!;
}

export function findDuplicateOrgs(opts?: FindDuplicateOrgsOptions): OrgDuplicateCandidate[] {
  const tiers = new Set<OrgDuplicateTier>(opts?.tiers ?? [1, 2]);
  const minConfidence = opts?.minConfidence ?? 0;
  const facts = [...loadOrgFacts().values()];

  const candidates: OrgDuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i]!;
      const b = facts[j]!;
      const evidence = evidenceFor(a, b);
      if (!evidence) continue;
      if (!tiers.has(evidence.tier) || evidence.confidence < minConfidence) continue;

      const key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const primary = pickPrimary([a, b]);
      const secondary = primary.id === a.id ? b : a;
      candidates.push({
        primaryOrgId: primary.id,
        secondaryOrgIds: [secondary.id],
        tier: evidence.tier,
        confidence: evidence.confidence,
        reason: evidence.reason,
        members: [primary, secondary].map((fact) => ({
          orgId: fact.id,
          name: fact.name,
          domain: fact.domain,
          contactCount: fact.contactCount,
          createdAt: fact.createdAt,
        })),
      });
    }
  }

  candidates.sort((a, b) => a.tier - b.tier || b.confidence - a.confidence);
  return opts?.limit ? candidates.slice(0, opts.limit) : candidates;
}
