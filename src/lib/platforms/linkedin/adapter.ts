import type {
  PlatformAdapter,
  PlatformCredentials,
  PlatformUserProfile,
  PaginatedResult,
  RateLimitState,
} from "@/lib/platforms/adapter";
import {
  getLinkedInClientCredentials,
  refreshLinkedInTokenAsync,
  disconnectLinkedInAccount,
} from "@/lib/platforms/linkedin/auth";
import { saveLinkedInOAuthState } from "@/lib/platforms/linkedin/oauth-state-store";
import {
  getAuthenticatedProfile,
  getAuthenticatedEmail,
  getConnections,
} from "@/lib/platforms/linkedin/client";
import { getRateLimitState } from "@/lib/platforms/rate-limiter";
import { PLATFORM_CAPABILITIES } from "@/lib/platforms/capabilities";
import { randomBytes } from "crypto";
import type { LinkedInProfile, LinkedInConnection } from "@/lib/platforms/linkedin/client";

/** Map a LinkedInProfile to the normalized PlatformUserProfile. */
function profileToUserProfile(
  profile: LinkedInProfile,
  email?: string | null
): PlatformUserProfile {
  // Support both OpenID Connect userinfo and legacy /me shapes
  const firstName = profile.given_name ?? profile.localizedFirstName ?? "";
  const lastName = profile.family_name ?? profile.localizedLastName ?? "";
  const displayName = profile.name ?? `${firstName} ${lastName}`.trim();
  const vanityName = profile.vanityName;

  // Extract photo: userinfo has `picture` directly, legacy uses nested structure
  let photoUrl: string | null = profile.picture ?? null;
  if (!photoUrl) {
    const elements = profile.profilePicture?.["displayImage~"]?.elements;
    if (elements && elements.length > 0) {
      photoUrl = elements[elements.length - 1]?.identifiers?.[0]?.identifier ?? null;
    }
  }

  return {
    platformUserId: profile.sub ?? profile.id ?? "",
    platformHandle: vanityName ? `/in/${vanityName}` : displayName,
    displayName,
    bio: profile.localizedHeadline ?? null,
    location: null, // Not available in basic profile
    website: null,
    photoUrl,
    followersCount: 0, // Not available in v2 basic scope
    followingCount: 0,
    rawData: { ...profile, email } as unknown as Record<string, unknown>,
  };
}

/** Map a LinkedInConnection to PlatformUserProfile. */
function connectionToUserProfile(connection: LinkedInConnection): PlatformUserProfile {
  const firstName = connection.localizedFirstName ?? "";
  const lastName = connection.localizedLastName ?? "";
  const displayName = `${firstName} ${lastName}`.trim();
  const vanityName = connection.vanityName;

  let photoUrl: string | null = null;
  const elements = connection.profilePicture?.["displayImage~"]?.elements;
  if (elements && elements.length > 0) {
    photoUrl = elements[elements.length - 1]?.identifiers?.[0]?.identifier ?? null;
  }

  return {
    platformUserId: connection.id,
    platformHandle: vanityName ? `/in/${vanityName}` : displayName,
    displayName,
    bio: connection.localizedHeadline ?? null,
    location: null,
    website: null,
    photoUrl,
    followersCount: 0,
    followingCount: 0,
    rawData: connection as unknown as Record<string, unknown>,
  };
}

export class LinkedInPlatformAdapter implements PlatformAdapter {
  readonly platform = "linkedin" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.linkedin!;

  async getAuthorizationUrl(redirectUri: string): Promise<{ authUrl: string; state: string }> {
    const { clientId } = getLinkedInClientCredentials();

    const state = randomBytes(16).toString("hex");
    saveLinkedInOAuthState(state);

    // Basic scopes: profile + email + connections
    const scopes = "openid profile email r_connections";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
    });

    return {
      authUrl: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
      state,
    };
  }

  async exchangeCode(
    _code: string,
    _state: string,
    _redirectUri: string
  ): Promise<PlatformCredentials> {
    // Code exchange is handled by the callback API route directly
    throw new Error("Use /api/platforms/linkedin/callback for code exchange");
  }

  async refreshToken(accountId: string): Promise<PlatformCredentials> {
    return refreshLinkedInTokenAsync(accountId);
  }

  async revokeToken(accountId: string): Promise<void> {
    return disconnectLinkedInAccount(accountId);
  }

  async getProfile(accountId: string): Promise<PlatformUserProfile> {
    const profile = await getAuthenticatedProfile(accountId);
    const email = await getAuthenticatedEmail(accountId);
    return profileToUserProfile(profile, email);
  }

  async getContacts(
    accountId: string,
    cursor?: string
  ): Promise<PaginatedResult<PlatformUserProfile>> {
    // Convert string cursor to offset (LinkedIn uses offset-based pagination)
    const start = cursor ? parseInt(cursor, 10) : 0;
    const res = await getConnections(accountId, { start, count: 50 });

    const items = (res.elements ?? []).map(connectionToUserProfile);
    const nextStart = start + (res.paging?.count ?? 50);
    const total = res.paging?.total ?? 0;
    const hasMore = nextStart < total;

    return {
      items,
      nextCursor: hasMore ? String(nextStart) : null,
      hasMore,
    };
  }

  async getUserById(
    _accountId: string,
    _userId: string
  ): Promise<PlatformUserProfile | null> {
    // LinkedIn v2 doesn't support looking up arbitrary users by ID with basic scopes
    return null;
  }

  getRateLimitState(accountId: string): RateLimitState {
    return getRateLimitState(accountId);
  }
}
