import { NextResponse } from "next/server";
import { buildSocialPlatformConnectionPayload } from "@/lib/platforms/browser-connection";

/**
 * GET /api/platforms/facebook
 * Connection status for Facebook — browser session only (no Meta OAuth).
 */
export async function GET() {
  const payload = await buildSocialPlatformConnectionPayload("facebook");
  return NextResponse.json(payload);
}
