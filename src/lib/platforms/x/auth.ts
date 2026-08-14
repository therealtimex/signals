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

/** Read X client credentials from env vars, falling back to config.json. */
export function getXClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  // Fallback: read from config.json
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.xClientId && config.xClientSecret) {
      return {
        clientId: config.xClientId,
        clientSecret: decrypt(config.xClientSecret),
      };
    }
  }

  throw new Error(
    "X client credentials not configured. Set X_CLIENT_ID and X_CLIENT_SECRET in .env.local"
  );
}

/** Decrypt stored credentials for a platform account. Auto-refreshes if near expiry. */
export function getXCredentials(accountId: string): PlatformCredentials {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for account");
  }

  const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const now = Math.floor(Date.now() / 1000);

  // Auto-refresh if within 5 minutes of expiry
  if (creds.expiresAt - now < 300) {
    return refreshXToken(accountId);
  }

  return creds;
}

/** Store encrypted credentials for a platform account. */
export function saveXCredentials(accountId: string, creds: PlatformCredentials): void {
  updatePlatformAccount(accountId, {
    credentialsEncrypted: encrypt(JSON.stringify(creds)),
    status: "active",
  });
}

/** Refresh the access token. X refresh tokens are single-use — stores the new one. */
export function refreshXToken(accountId: string): PlatformCredentials {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for account");
  }

  const oldCreds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const { clientId, clientSecret } = getXClientCredentials();

  // X token refresh is async — we need to call it synchronously for the DB layer.
  // This function is designed to be called from async API routes.
  // For the sync getXCredentials auto-refresh, the caller should handle the async refresh separately.
  throw new RefreshNeededError(accountId, oldCreds.refreshToken, clientId, clientSecret);
}

/** Signal that an async refresh is needed (caught by xApiFetch). */
export class RefreshNeededError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly refreshToken: string,
    public readonly clientId: string,
    public readonly clientSecret: string
  ) {
    super("Token refresh needed");
    this.name = "RefreshNeededError";
  }
}

/** Async token refresh — called from API routes and xApiFetch. */
export async function refreshXTokenAsync(accountId: string): Promise<PlatformCredentials> {
  const account = getPlatformAccountById(accountId);
  if (!account?.credentialsEncrypted) {
    throw new Error("No credentials found for account");
  }

  const oldCreds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
  const { clientId, clientSecret } = getXClientCredentials();

  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oldCreds.refreshToken,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    // Mark account as needing re-auth
    updatePlatformAccount(accountId, { status: "needs_reauth" });
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await res.json();
  const newCreds: PlatformCredentials = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // X issues a new refresh token
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    grantedScopes: data.scope ?? oldCreds.grantedScopes, // preserve scopes across refreshes
  };

  saveXCredentials(accountId, newCreds);
  return newCreds;
}

/** Revoke tokens and delete the platform account. */
export async function disconnectXAccount(accountId: string): Promise<void> {
  const account = getPlatformAccountById(accountId);

  if (account?.credentialsEncrypted) {
    try {
      const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
      const { clientId, clientSecret } = getXClientCredentials();

      // Revoke access token
      await fetch("https://api.x.com/2/oauth2/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          token: creds.accessToken,
          token_type_hint: "access_token",
        }),
      });
    } catch {
      // Best-effort revocation — proceed with deletion regardless
    }
  }

  if (account) {
    deletePlatformAccount(account.id);
  }
}
