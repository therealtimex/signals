import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { encrypt, decrypt } from "@/lib/auth/crypto";
import {
  getPlatformAccountById,
  updatePlatformAccount,
  deletePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import type { PlatformCredentials } from "@/lib/platforms/adapter";

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const configPath = join(dataDir, "config.json");

/** Read Google client credentials from env vars, falling back to config.json. */
export function getGoogleClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Fallback: read from config.json
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.googleClientId && config.googleClientSecret) {
      return {
        clientId: config.googleClientId,
        clientSecret: decrypt(config.googleClientSecret),
      };
    }
  }

  throw new Error(
    "Google client credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local"
  );
}

/** Decrypt stored credentials for a Gmail account. Throws RefreshNeededError if within 5 min of expiry. */
export function getGmailCredentials(accountId: string): PlatformCredentials {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for Gmail account");
  }

  const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const now = Math.floor(Date.now() / 1000);

  // Google tokens last ~1 hour — refresh if within 5 minutes of expiry
  const FIVE_MINUTES = 5 * 60;
  if (creds.expiresAt - now < FIVE_MINUTES) {
    throw new RefreshNeededError(accountId);
  }

  return creds;
}

/** Store encrypted credentials for a Gmail account. */
export function saveGmailCredentials(accountId: string, creds: PlatformCredentials): void {
  updatePlatformAccount(accountId, {
    credentialsEncrypted: encrypt(JSON.stringify(creds)),
    status: "active",
  });
}

/** Signal that an async refresh is needed (caught by googleApiFetch). */
export class RefreshNeededError extends Error {
  constructor(public readonly accountId: string) {
    super("Google token refresh needed");
    this.name = "RefreshNeededError";
  }
}

/** Async token refresh — called from API routes and googleApiFetch. */
export async function refreshGmailTokenAsync(accountId: string): Promise<PlatformCredentials> {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for Gmail account");
  }

  const oldCreds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const { clientId, clientSecret } = getGoogleClientCredentials();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oldCreds.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    // Mark account as needing re-auth
    updatePlatformAccount(accountId, { status: "needs_reauth" });
    throw new Error(`Google token refresh failed: ${error}`);
  }

  const data = await res.json();
  const newCreds: PlatformCredentials = {
    accessToken: data.access_token,
    // Google doesn't always return a new refresh token on refresh
    refreshToken: data.refresh_token ?? oldCreds.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    grantedScopes: data.scope ?? oldCreds.grantedScopes,
  };

  saveGmailCredentials(accountId, newCreds);
  return newCreds;
}

/** Revoke token and delete the platform account. Google supports token revocation. */
export async function disconnectGmailAccount(accountId: string): Promise<void> {
  const account = getPlatformAccountById(accountId);
  if (!account) return;

  // Attempt token revocation (best-effort)
  if (account.credentialsEncrypted) {
    try {
      const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
      await fetch(`https://oauth2.googleapis.com/revoke?token=${creds.accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // Revocation failure is non-fatal — we still delete the local account
    }
  }

  deletePlatformAccount(account.id);
}
