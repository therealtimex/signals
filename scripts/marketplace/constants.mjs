/** @typedef {'darwin_arm64' | 'darwin_x64' | 'linux_arm64' | 'linux_x64' | 'win32_arm64' | 'win32_x64'} MarketplaceArtifactTarget */

/** Maps release-manifest.json artifact keys to marketplace local_apps artifact targets. */
export const RELEASE_MANIFEST_TARGET_MAP = {
  "darwin-arm64": "darwin_arm64",
  "darwin-x64": "darwin_x64",
  "linux-arm64": "linux_arm64",
  "linux-x64": "linux_x64",
  "win32-arm64": "win32_arm64",
  "win32-x64": "win32_x64",
};

export const DEFAULT_MARKETPLACE_API =
  "https://marketplace-api-next.realtimex.ai";

/** Stable marketplace product id for com.realtimex.signals (RealTimeX publisher). */
export const SIGNALS_MARKETPLACE_PLUGIN_ID =
  "e1c6dd2e-4222-44fe-9e7d-55c6e9e14feb";

export const SIGNALS_PLUGIN_SLUG = "com.realtimex.signals";

export const KEYCLOAK_TOKEN_URL =
  "https://accounts.realtimex.ai/auth/realms/realtimex/protocol/openid-connect/token";

export const KEYCLOAK_CLIENT_ID = "realtimex-app";
