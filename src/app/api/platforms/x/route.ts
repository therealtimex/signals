import { NextResponse } from "next/server";
import {
  buildSocialPlatformConnectionPayload,
  isOAuthConnected,
} from "@/lib/platforms/browser-connection";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { disconnectXAccount } from "@/lib/platforms/x/auth";

/**
 * GET /api/platforms/x
 * Connection status for X — browser session is primary in Local App mode.
 */
export async function GET() {
  const payload = await buildSocialPlatformConnectionPayload("x");
  return NextResponse.json(payload);
}

/**
 * DELETE /api/platforms/x
 * Disconnect OAuth account (revoke tokens, delete row).
 */
export async function DELETE() {
  const account = getPlatformAccountByPlatform("x");

  if (!account || !isOAuthConnected(account)) {
    return NextResponse.json({ error: "No OAuth X account connected" }, { status: 404 });
  }

  try {
    await disconnectXAccount(account.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
