import { NextResponse } from "next/server";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { getLatestImportRun } from "@/lib/db/queries/workflows";
import { disconnectLinkedInAccount } from "@/lib/platforms/linkedin/auth";
import { decrypt } from "@/lib/auth/crypto";
import type { PlatformCredentials } from "@/lib/platforms/adapter";
import type { WorkflowRun } from "@/lib/db/types";

export interface LinkedInImportStats {
  status: WorkflowRun["status"];
  added: number;
  updated: number;
  skipped: number;
  lastRunAt: number;
  source: "csv" | "zip" | null;
  fileName: string | null;
}

/** Last-run stats for the Workflows import card, from the latest import run. */
function getImportStats(): LinkedInImportStats | null {
  const run = getLatestImportRun("linkedin");
  if (!run) return null;

  let source: "csv" | "zip" | null = null;
  let fileName: string | null = null;
  try {
    const config = JSON.parse(run.config ?? "{}");
    source = config.source ?? null;
    fileName = config.fileName ?? null;
  } catch {
    // Malformed config — still report counters and timestamp
  }

  let added = 0;
  let updated = 0;
  try {
    const result = JSON.parse(run.result ?? "{}");
    added = result.added ?? 0;
    updated = result.updated ?? 0;
  } catch {
    // Malformed result — fall back to run counters below
  }

  return {
    status: run.status,
    added,
    updated,
    skipped: run.skippedItems,
    lastRunAt: run.completedAt ?? run.createdAt,
    source,
    fileName,
  };
}

/**
 * GET /api/platforms/linkedin
 * Check LinkedIn connection status including granted scopes.
 * Also reports file-import stats, which exist even without a connected account.
 */
export async function GET() {
  const account = getPlatformAccountByPlatform("linkedin");
  const importStats = getImportStats();

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
