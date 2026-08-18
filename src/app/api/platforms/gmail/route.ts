import { NextResponse } from "next/server";
import { getLegacyGmailOAuthAccount } from "@/lib/db/queries/mail-accounts";
import { countContactsWithEmail } from "@/lib/db/queries/contacts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { disconnectGmailAccount } from "@/lib/platforms/gmail/auth";
import { getGoogleContacts } from "@/lib/platforms/gmail/client";
import { decrypt } from "@/lib/auth/crypto";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

/**
 * GET /api/platforms/gmail
 * Check Gmail connection status including granted scopes.
 */
export async function GET() {
  const account = getLegacyGmailOAuthAccount();

  if (!account) {
    return NextResponse.json({ connected: false });
  }

  // Extract granted scopes from encrypted credentials
  let grantedScopes = "";
  if (account.credentialsEncrypted) {
    try {
      const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
      grantedScopes = creds.grantedScopes ?? "";
    } catch {
      // Credentials may be corrupted — don't block the status response
    }
  }

  // Build sync stats for action cards + check Google contact count
  const cursors = listSyncCursors(account.id);
  const syncStats: Record<string, { totalSynced: number; lastSyncedAt: number | null }> = {};
  for (const c of cursors) {
    syncStats[c.dataType] = {
      totalSynced: c.totalItemsSynced ?? 0,
      lastSyncedAt: c.lastSyncCompletedAt,
    };
  }

  let googleContactCount: number | null = null;
  try {
    const contactsCursor = cursors.find(c => c.dataType === "google_contacts");

    if (contactsCursor && (contactsCursor.totalItemsSynced ?? 0) > 0) {
      // Previous sync found contacts — skip API call
      googleContactCount = contactsCursor.totalItemsSynced ?? 0;
    } else {
      // No sync yet or last sync found 0 — lightweight API check
      const res = await getGoogleContacts(account.id, { pageSize: 1 });
      googleContactCount = res.totalPeople ?? res.connections?.length ?? 0;
    }
  } catch {
    // Token expired or API error — don't restrict (null = unknown)
    googleContactCount = null;
  }

  return NextResponse.json({
    connected: true,
    syncStats,
    contactsWithEmailCount: countContactsWithEmail(),
    googleContactCount,
    account: {
      id: account.id,
      displayName: account.displayName,
      status: account.status,
      lastSyncedAt: account.lastSyncedAt,
      createdAt: account.createdAt,
      grantedScopes,
    },
  });
}

/**
 * DELETE /api/platforms/gmail
 * Disconnect Gmail account (revoke token + delete platform account row).
 */
export async function DELETE() {
  const account = getLegacyGmailOAuthAccount();

  if (!account) {
    return NextResponse.json({ error: "No Gmail account connected" }, { status: 404 });
  }

  try {
    await disconnectGmailAccount(account.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
