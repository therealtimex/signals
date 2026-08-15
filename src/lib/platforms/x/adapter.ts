import type {
  PlatformAdapter,
  PlatformCredentials,
  PlatformUserProfile,
  PaginatedResult,
  RateLimitState,
} from "@/lib/platforms/adapter";
import { getXClientCredentials, refreshXTokenAsync, disconnectXAccount } from "@/lib/platforms/x/auth";
import { savePkceState } from "@/lib/platforms/x/pkce-store";
import {
  getAuthenticatedUser,
  getUserById as xGetUserById,
  getFollowing,
} from "@/lib/platforms/x/client";
import { getRateLimitState } from "@/lib/platforms/rate-limiter";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { PLATFORM_CAPABILITIES } from "@/lib/platforms/capabilities";
import { randomBytes, createHash } from "crypto";
import type { XUser } from "@/lib/platforms/x/client";

/** Map an XUser to the normalized PlatformUserProfile. */
function toProfile(xUser: XUser): PlatformUserProfile {
  return {
    platformUserId: xUser.id,
    platformHandle: `@${xUser.username}`,
    displayName: xUser.name,
    bio: xUser.description ?? null,
    location: xUser.location ?? null,
    website: xUser.url ?? null,
    photoUrl: xUser.profile_image_url?.replace("_normal", "_400x400") ?? null,
    followersCount: xUser.public_metrics?.followers_count ?? 0,
    followingCount: xUser.public_metrics?.following_count ?? 0,
    rawData: xUser as unknown as Record<string, unknown>,
  };
}

export class XPlatformAdapter implements PlatformAdapter {
  readonly platform = "x" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.x!;

  async getAuthorizationUrl(redirectUri: string, extended = false): Promise<{ authUrl: string; state: string }> {
    const { clientId } = getXClientCredentials();

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = randomBytes(16).toString("hex");

    savePkceState(state, codeVerifier, extended);

    // Free tier: CRM engagement + messaging; Extended (Basic+): adds contact management
    const FREE_SCOPES = "tweet.read tweet.write tweet.moderate.write users.read like.read like.write bookmark.read bookmark.write dm.read dm.write offline.access";
    const EXTENDED_SCOPES = "tweet.read tweet.write tweet.moderate.write users.read like.read like.write bookmark.read bookmark.write dm.read dm.write follows.read follows.write list.read list.write mute.read mute.write block.read block.write space.read offline.access";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: extended ? EXTENDED_SCOPES : FREE_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return {
      authUrl: `https://x.com/i/oauth2/authorize?${params.toString()}`,
      state,
    };
  }

  async exchangeCode(
    code: string,
    _state: string,
    redirectUri: string
  ): Promise<PlatformCredentials> {
    // Code exchange is handled by the callback API route directly
    // This is here to satisfy the interface
    throw new Error("Use /api/platforms/x/callback for code exchange");
  }

  async refreshToken(accountId: string): Promise<PlatformCredentials> {
    return refreshXTokenAsync(accountId);
  }

  async revokeToken(accountId: string): Promise<void> {
    return disconnectXAccount(accountId);
  }

  async getProfile(accountId: string): Promise<PlatformUserProfile> {
    const xUser = await getAuthenticatedUser(accountId);
    return toProfile(xUser);
  }

  async getContacts(
    accountId: string,
    cursor?: string
  ): Promise<PaginatedResult<PlatformUserProfile>> {
    // Get the authenticated user's ID to fetch their "following" list
    const account = getPlatformAccountByPlatform("x");
    if (!account) throw new Error("No X account connected");

    const me = await getAuthenticatedUser(accountId);
    const res = await getFollowing(accountId, me.id, {
      maxResults: 100,
      paginationToken: cursor || undefined,
    });

    const items = Array.isArray(res.data) ? res.data.map(toProfile) : [];

    return {
      items,
      nextCursor: res.meta?.next_token ?? null,
      hasMore: !!res.meta?.next_token,
    };
  }

  async getUserById(
    accountId: string,
    userId: string
  ): Promise<PlatformUserProfile | null> {
    try {
      const xUser = await xGetUserById(accountId, userId);
      return toProfile(xUser);
    } catch {
      return null;
    }
  }

  getRateLimitState(accountId: string): RateLimitState {
    return getRateLimitState(accountId);
  }
}
