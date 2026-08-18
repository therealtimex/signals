import { NextResponse } from "next/server";
import {
  buildSocialPlatformConnectionPayload,
  isOAuthConnected,
} from "@/lib/platforms/browser-connection";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { disconnectLinkedInAccount } from "@/lib/platforms/linkedin/auth";

/**
 * GET /api/platforms/linkedin
 * Connection status for LinkedIn — browser session is primary in Local App mode.
 */
export async function GET() {
  const payload = await buildSocialPlatformConnectionPayload("linkedin");
  return NextResponse.json(payload);
}

/**
 * DELETE /api/platforms/linkedin
 * Disconnect OAuth account (delete platform account row).
 */
export async function DELETE() {
  const account = getPlatformAccountByPlatform("linkedin");

  if (!account || !isOAuthConnected(account)) {
    return NextResponse.json({ error: "No OAuth LinkedIn account connected" }, { status: 404 });
  }

  try {
    await disconnectLinkedInAccount(account.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
