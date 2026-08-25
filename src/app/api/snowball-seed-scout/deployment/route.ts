import { NextResponse } from "next/server";
import { readSnowballSeedScoutDeployment } from "@/lib/rtx/deploy-snowball-seed-scout";

/**
 * GET /api/snowball-seed-scout/deployment
 */
export async function GET() {
  const result = await readSnowballSeedScoutDeployment();
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ deployment: result.deployment });
}
