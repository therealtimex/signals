import { NextResponse } from "next/server";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { getPlatformImportStats } from "@/lib/workflows/import-stats";
import { disconnectLinkedInAccount } from "@/lib/platforms/linkedin/auth";
import { decrypt } from "@/lib/auth/crypto";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/linkedin
 * Check LinkedIn connection status including granted scopes.
 * Also reports file-import stats, which exist even without a connected account.
 */
export async function GET() {
  const account = getPlatformAccountByPlatform("linkedin");
  const importStats = getPlatformImportStats("linkedin");

  if (!account) {
    return NextResponse.json({ connected: false, importStats });
  }

  // Extract granted scopes + sync capability from encrypted credentials
  let grantedScopes = "";
  let syncCapable = false;
  if (account.credentialsEncrypted) {
    try {
      const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
      grantedScopes = (creds.grantedScopes ?? "").replace(/,/g, " ");
      syncCapable = grantedScopes.includes("r_connections");
    } catch {
      // Credentials may be corrupted — don't block the status response
    }
  }

  const cursors = listSyncCursors(account.id);
  const syncStats: Record<string, { totalSynced: number; lastSyncedAt: number | null }> = {};
  for (const c of cursors) {
    syncStats[c.dataType] = {
      totalSynced: c.totalItemsSynced ?? 0,
      lastSyncedAt: c.lastSyncCompletedAt,
    };
  }

  return NextResponse.json({
    connected: true,
    syncStats,
    importStats,
    account: {
      id: account.id,
      displayName: account.displayName,
      status: account.status,
      lastSyncedAt: account.lastSyncedAt,
      createdAt: account.createdAt,
      grantedScopes,
      syncCapable,
    },
  });
}

/**
 * DELETE /api/platforms/linkedin
 * Disconnect LinkedIn account (delete platform account row).
 */
export async function DELETE() {
  const account = getPlatformAccountByPlatform("linkedin");

  if (!account) {
    return NextResponse.json({ error: "No LinkedIn account connected" }, { status: 404 });
  }

  try {
    await disconnectLinkedInAccount(account.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
