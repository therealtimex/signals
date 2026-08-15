import type { Platform } from "@/lib/db/platforms";
import {
  PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
} from "@/lib/platforms/capabilities";
import {
  NotImplementedError,
  type PlatformAdapter,
  type PlatformCredentials,
  type PlatformUserProfile,
  type PaginatedResult,
  type RateLimitState,
} from "@/lib/platforms/adapter";

/** Base stub — every method throws NotImplementedError. */
export class StubPlatformAdapter implements PlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  constructor(platform: Platform) {
    const caps = PLATFORM_CAPABILITIES[platform];
    if (!caps) {
      throw new Error(`No capabilities entry for platform: ${platform}`);
    }
    this.platform = platform;
    this.capabilities = caps;
  }

  async getAuthorizationUrl(): Promise<{ authUrl: string; state: string }> {
    throw new NotImplementedError(this.platform, "getAuthorizationUrl");
  }

  async exchangeCode(): Promise<PlatformCredentials> {
    throw new NotImplementedError(this.platform, "exchangeCode");
  }

  async refreshToken(): Promise<PlatformCredentials> {
    throw new NotImplementedError(this.platform, "refreshToken");
  }

  async revokeToken(): Promise<void> {
    throw new NotImplementedError(this.platform, "revokeToken");
  }

  async getProfile(): Promise<PlatformUserProfile> {
    throw new NotImplementedError(this.platform, "getProfile");
  }

  async getContacts(): Promise<PaginatedResult<PlatformUserProfile>> {
    throw new NotImplementedError(this.platform, "getContacts");
  }

  async getUserById(): Promise<PlatformUserProfile | null> {
    throw new NotImplementedError(this.platform, "getUserById");
  }

  getRateLimitState(): RateLimitState {
    throw new NotImplementedError(this.platform, "getRateLimitState");
  }
}
