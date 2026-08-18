import { NextRequest, NextResponse } from "next/server";
import { getLegacyGmailOAuthAccount } from "@/lib/db/queries/mail-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { syncContactsFromGmail } from "@/lib/platforms/sync-gmail-contacts";
import { syncGmailMetadata } from "@/lib/platforms/sync-gmail-metadata";
import { runSyncWorkflow } from "@/lib/workflows/run-sync-workflow";

/**
 * POST /api/platforms/gmail/sync
 * Trigger a sync from Gmail/Google.
 * Body: { type: "contacts" | "metadata" }
 */
export async function POST(req: NextRequest) {
  try {
    const account = getLegacyGmailOAuthAccount();
    if (!account) {
      return NextResponse.json(
        { error: "No Gmail account connected" },
        { status: 400 }
      );
    }

    if (account.status === "needs_reauth") {
      return NextResponse.json(
        { error: "Gmail account needs re-authentication" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const syncType = body.type || "contacts";

    switch (syncType) {
      case "metadata": {
        const maxContacts = body.maxContacts ?? 50;
        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "enrich",
          syncSubType: "gmail_metadata",
          platformAccountId: account.id,
          syncFunction: () => syncGmailMetadata(account.id, { maxContacts }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }
      case "contacts":
      default: {
        const maxPages = body.maxPages ?? 10;
        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "sync",
          syncSubType: "gmail_contacts",
          platformAccountId: account.id,
          syncFunction: () => syncContactsFromGmail(account.id, { maxPages }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/platforms/gmail/sync
 * Get sync status for the Gmail account.
 */
export async function GET() {
  const account = getLegacyGmailOAuthAccount();
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
