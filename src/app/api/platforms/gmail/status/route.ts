import { NextResponse } from "next/server";
import { listHimalayaMailAccounts } from "@/lib/db/queries/mail-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { getPlatformImportStats } from "@/lib/workflows/import-stats";

/**
 * GET /api/platforms/gmail/status
 * Himalaya mail workflow status for Automation cards (no OAuth required).
 */
export async function GET() {
  const mailAccounts = listHimalayaMailAccounts();
  const defaultAccount =
    mailAccounts.find((account) => account.isDefault) ?? mailAccounts[0] ?? null;

  const syncStats: Record<string, { totalSynced: number; lastSyncedAt: number | null }> = {};

  if (defaultAccount) {
    const cursors = listSyncCursors(defaultAccount.id);
    for (const cursor of cursors) {
      syncStats[cursor.dataType] = {
        totalSynced: cursor.totalItemsSynced ?? 0,
        lastSyncedAt: cursor.lastSyncCompletedAt,
      };
    }
  }

  return NextResponse.json({
    connected: mailAccounts.length > 0,
    mailAccountCount: mailAccounts.length,
    mailAccounts: mailAccounts.map((account) => ({
      id: account.id,
      alias: account.alias,
      email: account.email,
      isDefault: account.isDefault,
    })),
    defaultMailAccountId: defaultAccount?.id ?? null,
    syncStats,
    importStats: getPlatformImportStats("gmail"),
  });
}
