import type { Platform } from "@/lib/db/platforms";
import type { PlatformCapabilities } from "@/lib/platforms/capabilities";

/** Thrown when a platform adapter or method is not implemented. */
export class NotImplementedError extends Error {
  readonly platform: Platform;
  readonly method: string;

  constructor(platform: Platform, method: string) {
    super(`Platform "${platform}" does not implement ${method}`);
    this.name = "NotImplementedError";
    this.platform = platform;
    this.method = method;
  }
}

/** Decrypted OAuth credentials for a platform account. */
export interface PlatformCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  grantedScopes?: string; // space-separated scopes actually granted by the platform
}

/** Normalized user profile returned from any platform. */
export interface PlatformUserProfile {
  platformUserId: string;
  platformHandle: string;
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  photoUrl: string | null;
  followersCount: number;
  followingCount: number;
  rawData: Record<string, unknown>;
}

/** Generic paginated result. */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Result summary from a contact sync operation. */
export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Per-endpoint rate limit tracking. */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetsAt: number; // unix seconds
}

/** Full rate limit state for an account (keyed by endpoint pattern). */
export type RateLimitState = Record<string, RateLimitInfo>;

/** Generic platform adapter — each social platform implements this contract. */
export interface PlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  /** Generate the OAuth authorization URL for initial connection. */
  getAuthorizationUrl(redirectUri: string, extended?: boolean): Promise<{ authUrl: string; state: string }>;

  /** Exchange an OAuth authorization code for access/refresh tokens. */
  exchangeCode(code: string, state: string, redirectUri: string): Promise<PlatformCredentials>;

  /** Refresh an expired access token. Returns new credentials. */
  refreshToken(accountId: string): Promise<PlatformCredentials>;

  /** Revoke tokens and clean up. */
  revokeToken(accountId: string): Promise<void>;

  /** Fetch the authenticated user's profile. */
  getProfile(accountId: string): Promise<PlatformUserProfile>;

  /** Fetch the user's contacts/connections (paginated). */
  getContacts(accountId: string, cursor?: string): Promise<PaginatedResult<PlatformUserProfile>>;

  /** Look up a single user by platform-specific ID. */
  getUserById(accountId: string, userId: string): Promise<PlatformUserProfile | null>;

  /** Get current rate limit state from the DB. */
  getRateLimitState(accountId: string): RateLimitState;
}
