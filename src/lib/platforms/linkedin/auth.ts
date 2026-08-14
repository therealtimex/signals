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

/** Read LinkedIn client credentials from env vars, falling back to config.json. */
export function getLinkedInClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Fallback: read from config.json
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.linkedinClientId && config.linkedinClientSecret) {
      return {
        clientId: config.linkedinClientId,
        clientSecret: decrypt(config.linkedinClientSecret),
      };
    }
  }

  throw new Error(
    "LinkedIn client credentials not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env.local"
  );
}

/** Decrypt stored credentials for a LinkedIn account. Auto-refreshes if within 5 days of expiry. */
export function getLinkedInCredentials(accountId: string): PlatformCredentials {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for LinkedIn account");
  }

  const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const now = Math.floor(Date.now() / 1000);

  // LinkedIn tokens last 60 days — refresh if within 5 days of expiry
  const FIVE_DAYS = 5 * 24 * 60 * 60;
  if (creds.expiresAt - now < FIVE_DAYS) {
    throw new RefreshNeededError(accountId);
  }

  return creds;
}

/** Store encrypted credentials for a LinkedIn account. */
export function saveLinkedInCredentials(accountId: string, creds: PlatformCredentials): void {
  updatePlatformAccount(accountId, {
    credentialsEncrypted: encrypt(JSON.stringify(creds)),
    status: "active",
  });
}

/** Signal that an async refresh is needed (caught by linkedInApiFetch). */
export class RefreshNeededError extends Error {
  constructor(public readonly accountId: string) {
    super("LinkedIn token refresh needed");
    this.name = "RefreshNeededError";
  }
}

/** Async token refresh — called from API routes and linkedInApiFetch. */
export async function refreshLinkedInTokenAsync(accountId: string): Promise<PlatformCredentials> {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for LinkedIn account");
  }

  const oldCreds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const { clientId, clientSecret } = getLinkedInClientCredentials();

  // LinkedIn sends client_id/client_secret as POST body params (NOT Basic auth header)
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
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
    throw new Error(`LinkedIn token refresh failed: ${error}`);
  }

  const data = await res.json();
  const newCreds: PlatformCredentials = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? oldCreds.refreshToken, // LinkedIn may not always return a new refresh token
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    grantedScopes: data.scope ?? oldCreds.grantedScopes,
  };

  saveLinkedInCredentials(accountId, newCreds);
  return newCreds;
}

/** Delete the platform account (LinkedIn has no standard revocation endpoint). */
export async function disconnectLinkedInAccount(accountId: string): Promise<void> {
  const account = getPlatformAccountById(accountId);
  if (account) {
    deletePlatformAccount(account.id);
  }
}
