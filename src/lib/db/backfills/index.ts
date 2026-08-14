import { backfillOrgs } from "@/lib/db/backfills/orgs";
import { backfillWorksAt } from "@/lib/db/backfills/works-at";
import { backfillInteractions } from "@/lib/db/backfills/interactions";
import { backfillEngagedWithEdges } from "@/lib/db/backfills/engaged-with";
import { backfillNichesFromInterests } from "@/lib/db/backfills/niches-from-interests";
import { backfillInteractionReadParity } from "@/lib/db/backfills/interaction-read-parity";

export type GraphBackfillResult = {
  orgs: { inserted: number };
  worksAt: { upserted: number; skipped: number };
  interactions: { inserted: number; skipped: number };
  engagedWith: { upserted: number };
  niches: { nichesCreated: number; edgesUpserted: number };
  interactionParity: { updated: number };
};

/** Run Phase 1+2 graph backfills in dependency order (idempotent). */
export function runGraphBackfills(): GraphBackfillResult {
  const orgs = backfillOrgs();
  const worksAt = backfillWorksAt();
  const interactionResult = backfillInteractions();
  const engagedWith = backfillEngagedWithEdges();
  const nicheResult = backfillNichesFromInterests();
  const interactionParity = backfillInteractionReadParity();

  return {
    orgs,
    worksAt,
    interactions: interactionResult,
    engagedWith,
    niches: nicheResult,
    interactionParity,
  };
}
