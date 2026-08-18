import { NextRequest, NextResponse } from "next/server";
import { getLegacyGmailOAuthAccount, listHimalayaMailAccounts } from "@/lib/db/queries/mail-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import {
  syncHimalayaCorrespondents,
  syncHimalayaMailActivity,
} from "@/lib/platforms/gmail/himalaya-mail-scan";
import { syncContactsFromGmail } from "@/lib/platforms/sync-gmail-contacts";
import { syncGmailMetadata } from "@/lib/platforms/sync-gmail-metadata";
import { runSyncWorkflow } from "@/lib/workflows/run-sync-workflow";

/**
 * POST /api/platforms/gmail/sync
 * Trigger Gmail/Google sync workflows.
 * Body: { type: "contacts" | "metadata" | "correspondents" | "mail_activity", mailAccountId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const syncType = body.type || "contacts";

    switch (syncType) {
      case "correspondents": {
        const mailAccounts = listHimalayaMailAccounts();
        if (mailAccounts.length === 0) {
          return NextResponse.json(
            { error: "No Himalaya mail accounts registered — add one in Settings" },
            { status: 400 }
          );
        }

        const mailAccountId = body.mailAccountId as string | undefined;
        const account =
          mailAccounts.find((row) => row.id === mailAccountId) ??
          mailAccounts.find((row) => row.isDefault) ??
          mailAccounts[0]!;

        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "sync",
          syncSubType: "himalaya_correspondents",
          platformAccountId: account.id,
          syncFunction: () => syncHimalayaCorrespondents(mailAccountId, { maxEnvelopes: body.maxEnvelopes }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }

      case "mail_activity": {
        const mailAccounts = listHimalayaMailAccounts();
        if (mailAccounts.length === 0) {
          return NextResponse.json(
            { error: "No Himalaya mail accounts registered — add one in Settings" },
            { status: 400 }
          );
        }

        const mailAccountId = body.mailAccountId as string | undefined;
        const account =
          mailAccounts.find((row) => row.id === mailAccountId) ??
          mailAccounts.find((row) => row.isDefault) ??
          mailAccounts[0]!;

        const { workflowRun, syncResult } = await runSyncWorkflow({
          workflowType: "enrich",
          syncSubType: "himalaya_mail_activity",
          platformAccountId: account.id,
          syncFunction: () => syncHimalayaMailActivity(mailAccountId, { maxEnvelopes: body.maxEnvelopes }),
        });
        return NextResponse.json({ success: true, result: syncResult, workflowRunId: workflowRun.id });
      }

      case "metadata": {
        const account = getLegacyGmailOAuthAccount();
        if (!account) {
          return NextResponse.json({ error: "No legacy Gmail OAuth account connected" }, { status: 400 });
        }
        if (account.status === "needs_reauth") {
          return NextResponse.json({ error: "Gmail account needs re-authentication" }, { status: 401 });
        }

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
        const account = getLegacyGmailOAuthAccount();
        if (!account) {
          return NextResponse.json({ error: "No legacy Gmail OAuth account connected" }, { status: 400 });
        }
        if (account.status === "needs_reauth") {
          return NextResponse.json({ error: "Gmail account needs re-authentication" }, { status: 401 });
        }

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
 * Get sync status for Gmail/Himalaya accounts.
 */
export async function GET() {
  const himalayaAccounts = listHimalayaMailAccounts();
  const oauthAccount = getLegacyGmailOAuthAccount();
  const himalayaAccount =
    himalayaAccounts.find((row) => row.isDefault) ?? himalayaAccounts[0] ?? null;

  if (!himalayaAccount && !oauthAccount) {
    return NextResponse.json({ synced: false });
  }

  const accountId = himalayaAccount?.id ?? oauthAccount!.id;
  const cursors = listSyncCursors(accountId);
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
    synced: cursors.some((c) => !!c.lastSyncCompletedAt),
    lastSyncedAt: cursors.reduce<number | null>((latest, cursor) => {
      if (!cursor.lastSyncCompletedAt) return latest;
      if (!latest || cursor.lastSyncCompletedAt > latest) return cursor.lastSyncCompletedAt;
      return latest;
    }, null),
    status: himalayaAccount?.status ?? oauthAccount?.status ?? "unknown",
    cursors: cursorMap,
  });
}
