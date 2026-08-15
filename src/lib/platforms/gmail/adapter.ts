import type {
  PlatformAdapter,
  PlatformCredentials,
  PlatformUserProfile,
  PaginatedResult,
  RateLimitState,
} from "@/lib/platforms/adapter";
import {
  getGoogleClientCredentials,
  refreshGmailTokenAsync,
  disconnectGmailAccount,
} from "@/lib/platforms/gmail/auth";
import { saveGmailOAuthState } from "@/lib/platforms/gmail/oauth-state-store";
import {
  getAuthenticatedGoogleProfile,
  getGoogleContacts,
} from "@/lib/platforms/gmail/client";
import {
  mapGoogleUserInfoToProfile,
  mapGooglePersonToUserProfile,
} from "@/lib/platforms/gmail/mappers";
import { getRateLimitState } from "@/lib/platforms/rate-limiter";
import { PLATFORM_CAPABILITIES } from "@/lib/platforms/capabilities";
import { randomBytes } from "crypto";

// Google OAuth scopes — OpenID Connect (for userinfo) + read-only contacts + Gmail read
// Note: gmail.readonly is required (not gmail.metadata) because messages.list `q` parameter
// is only supported with gmail.readonly or higher scopes.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export class GmailPlatformAdapter implements PlatformAdapter {
  readonly platform = "gmail" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.gmail!;

  async getAuthorizationUrl(redirectUri: string): Promise<{ authUrl: string; state: string }> {
    const { clientId } = getGoogleClientCredentials();

    const state = randomBytes(16).toString("hex");
    saveGmailOAuthState(state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      access_type: "offline", // Required to get a refresh token
      prompt: "consent",      // Forces consent screen — ensures refresh token is returned
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  async exchangeCode(
    _code: string,
    _state: string,
    _redirectUri: string
  ): Promise<PlatformCredentials> {
    // Code exchange is handled by the callback API route directly
    throw new Error("Use /api/platforms/gmail/callback for code exchange");
  }

  async refreshToken(accountId: string): Promise<PlatformCredentials> {
    return refreshGmailTokenAsync(accountId);
  }

  async revokeToken(accountId: string): Promise<void> {
    return disconnectGmailAccount(accountId);
  }

  async getProfile(accountId: string): Promise<PlatformUserProfile> {
    const userinfo = await getAuthenticatedGoogleProfile(accountId);
    return mapGoogleUserInfoToProfile(userinfo);
  }

  async getContacts(
    accountId: string,
    cursor?: string
  ): Promise<PaginatedResult<PlatformUserProfile>> {
    const res = await getGoogleContacts(accountId, {
      pageToken: cursor || undefined,
      pageSize: 100,
    });

    const items = (res.connections ?? []).map(mapGooglePersonToUserProfile);

    return {
      items,
      nextCursor: res.nextPageToken ?? null,
      hasMore: !!res.nextPageToken,
    };
  }

  async getUserById(
    _accountId: string,
    _userId: string
  ): Promise<PlatformUserProfile | null> {
    // People API doesn't support arbitrary user lookup by ID
    return null;
  }

  getRateLimitState(accountId: string): RateLimitState {
    return getRateLimitState(accountId);
  }
}
