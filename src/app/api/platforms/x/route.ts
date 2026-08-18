import { NextResponse } from "next/server";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { getPlatformImportStats } from "@/lib/workflows/import-stats";
import { disconnectXAccount } from "@/lib/platforms/x/auth";
import { decrypt } from "@/lib/auth/crypto";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/x
 * Check X connection status including granted scopes / sync capability.
 * Also reports file-import stats, which exist even without a connected account.
 */
export async function GET() {
  const account = getPlatformAccountByPlatform("x");
  const importStats = getPlatformImportStats("x");

  if (!account) {
    return NextResponse.json({ connected: false, importStats });
  }

  // Determine granted scopes from encrypted credentials
  let grantedScopes = "";
  let syncCapable = false;
  if (account.credentialsEncrypted) {
    try {
      const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
      grantedScopes = creds.grantedScopes ?? "";
      syncCapable = grantedScopes.includes("follows.read");
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
    // Archive imports may create a credential-less placeholder account row —
    // that isn't a connection. OAuth always stores encrypted credentials.
    connected: !!account.credentialsEncrypted,
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
 * DELETE /api/platforms/x
 * Disconnect X account (revoke tokens, delete row).
 */
export async function DELETE() {
  const account = getPlatformAccountByPlatform("x");

  if (!account) {
    return NextResponse.json({ error: "No X account connected" }, { status: 404 });
  }

  try {
    await disconnectXAccount(account.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
