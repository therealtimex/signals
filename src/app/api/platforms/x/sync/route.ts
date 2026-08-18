import { NextRequest, NextResponse } from "next/server";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { syncContactsFromPlatform } from "@/lib/platforms/sync-contacts";
import { syncTweetsFromX, syncMentionsFromX } from "@/lib/platforms/sync-content";
import { TierRestrictedError } from "@/lib/platforms/x/client";
import { decrypt } from "@/lib/auth/crypto";
import { runSyncWorkflow } from "@/lib/workflows/run-sync-workflow";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * POST /api/platforms/x/sync
 * Trigger a sync from X.
 * Body: { type: "contacts" | "tweets" | "mentions" }
 *   - contacts: imports following list (requires follows.read, Basic+ tier)
 *   - tweets: imports user's own tweets (requires tweet.read, Free tier)
 *   - mentions: imports mentions of user (requires tweet.read, Free tier)
 */
export async function POST(req: NextRequest) {
  try {
    const account = getPlatformAccountByPlatform("x");
    // A credential-less row is an archive-import placeholder, not a connection.
    if (!account || !account.credentialsEncrypted) {
      return NextResponse.json(
        { error: "No X account connected" },
        { status: 400 }
      );
    }

    if (account.status === "needs_reauth") {
      return NextResponse.json(
        { error: "X account needs re-authentication" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const syncType = body.type || "contacts";

    // Route to the appropriate sync handler (each wrapped with workflow tracking)
    switch (syncType) {
      case "tweets": {
        const maxPages = body.maxPages ?? 5;
        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "sync",
          syncSubType: "x_tweets",
          platformAccountId: account.id,
          syncFunction: () => syncTweetsFromX(account.id, { maxPages }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }

      case "mentions": {
        const maxPages = body.maxPages ?? 5;
        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "sync",
          syncSubType: "x_mentions",
          platformAccountId: account.id,
          syncFunction: () => syncMentionsFromX(account.id, { maxPages }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }

      case "contacts":
      default: {
        // Contact sync requires follows.read scope (Basic+ tier)
        if (account.credentialsEncrypted) {
          try {
            const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
            if (!creds.grantedScopes?.includes("follows.read")) {
              return NextResponse.json(
                {
                  error: "Contact sync requires the follows.read scope. Click \"Enable Contact Sync\" to upgrade permissions (requires X API Basic tier, $200/mo).",
                  code: "TIER_RESTRICTED",
                },
                { status: 403 }
              );
            }
          } catch {
            // If we can't read credentials, let the sync attempt proceed and fail naturally
          }
        }

        const maxPages = body.type === "delta" ? 2 : 10;
        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "sync",
          syncSubType: "x_contacts",
          platformAccountId: account.id,
          syncFunction: () => syncContactsFromPlatform(account.id, { maxPages }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }
    }
  } catch (error) {
    if (error instanceof TierRestrictedError) {
      return NextResponse.json(
        {
          error: "This sync requires a higher X API tier. Check your X Developer Portal settings.",
          code: "TIER_RESTRICTED",
        },
        { status: 403 }
      );
    }
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/platforms/x/sync
 * Get sync status/stats for the X account, including per-type cursors.
 */
export async function GET() {
  const account = getPlatformAccountByPlatform("x");
  if (!account) {
    return NextResponse.json({ synced: false });
  }

  // Get sync cursors for detailed per-type status
  const cursors = listSyncCursors(account.id);
  const cursorMap: Record<string, {
    status: string;
    totalSynced: number;
    lastSyncedAt: number | null;
    lastError: string | null;
  }> = {};

  for (const c of cursors) {
    cursorMap[c.dataType] = {
      status: c.syncStatus,
      totalSynced: c.totalItemsSynced,
      lastSyncedAt: c.lastSyncCompletedAt,
      lastError: c.lastError,
    };
  }

  return NextResponse.json({
    synced: !!account.lastSyncedAt,
    lastSyncedAt: account.lastSyncedAt,
    status: account.status,
    cursors: cursorMap,
  });
}
