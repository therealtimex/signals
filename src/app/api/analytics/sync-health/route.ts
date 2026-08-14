import { NextRequest, NextResponse } from "next/server";
import { parseSinceFromRange } from "@/lib/analytics/utils";
import {
  getSyncHealthByPlatform,
  getSyncActivityOverTime,
  getRecentSyncErrors,
} from "@/lib/db/queries/analytics";
import { getGraphIntegritySummary } from "@/lib/db/graph-integrity";

/**
 * GET /api/analytics/sync-health?range=30d
 * Returns platform sync health, activity, and errors.
 */
export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range");
  const since = parseSinceFromRange(range);

  return NextResponse.json({
    platformHealth: getSyncHealthByPlatform(),
    syncActivity: getSyncActivityOverTime(since),
    recentErrors: getRecentSyncErrors(),
    graphIntegrity: getGraphIntegritySummary(),
  });
}
