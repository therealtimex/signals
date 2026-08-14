import { backfillOrgs } from "@/lib/db/backfills/orgs";
import { backfillWorksAt } from "@/lib/db/backfills/works-at";
import { backfillInteractions } from "@/lib/db/backfills/interactions";
import { backfillEngagedWithEdges } from "@/lib/db/backfills/engaged-with";

export type GraphBackfillResult = {
  orgs: { inserted: number };
  worksAt: { upserted: number; skipped: number };
  interactions: { inserted: number; skipped: number };
  engagedWith: { upserted: number };
};

/** Run Phase 1 graph backfills in dependency order (idempotent). */
export function runGraphBackfills(): GraphBackfillResult {
  const orgs = backfillOrgs();
  const worksAt = backfillWorksAt();
  const interactionResult = backfillInteractions();
  const engagedWith = backfillEngagedWithEdges();

  return {
    orgs,
    worksAt,
    interactions: interactionResult,
    engagedWith,
  };
}
