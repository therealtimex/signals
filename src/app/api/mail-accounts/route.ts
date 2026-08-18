import { NextResponse } from "next/server";
import {
  getLegacyGmailOAuthAccount,
  listHimalayaMailAccounts,
  syncMailAccountsFromHimalaya,
} from "@/lib/db/queries/mail-accounts";
import { getHimalayaConfigPath, listHimalayaAccounts } from "@/lib/mail/himalaya";

/**
 * GET /api/mail-accounts
 * List registered Himalaya mail accounts and legacy OAuth migration notice.
 */
export async function GET() {
  const accounts = listHimalayaMailAccounts();
  const legacyOAuth = getLegacyGmailOAuthAccount();

  return NextResponse.json({
    accounts,
    configPath: getHimalayaConfigPath(),
    legacyOAuth: legacyOAuth
      ? {
          id: legacyOAuth.id,
          displayName: legacyOAuth.displayName,
          message:
            "Mail has moved to Himalaya CLI. Disconnect this legacy Gmail OAuth connection after configuring Himalaya accounts.",
        }
      : null,
  });
}

/**
 * POST /api/mail-accounts
 * Refresh registry from Himalaya (`account list` / config parse).
 */
export async function POST() {
  try {
    const discovered = await listHimalayaAccounts();
    const accounts = syncMailAccountsFromHimalaya(discovered);
    return NextResponse.json({ accounts, discoveredCount: discovered.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync mail accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
