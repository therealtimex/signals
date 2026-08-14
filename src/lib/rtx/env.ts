const API_BASE_ENV_KEYS = [
  "RTX_API_BASE_URL",
  "SERVER_URL",
  "REALTIMEX_BASE_URL",
] as const;

export type EnvLike = Record<string, string | undefined>;

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getRtxAppId(env: EnvLike = process.env): string | null {
  const value = env.RTX_APP_ID?.trim();
  return value || null;
}

export function getRtxAppName(env: EnvLike = process.env): string | null {
  const value = env.RTX_APP_NAME?.trim();
  return value || null;
}

export function isRtxEmbedded(env: EnvLike = process.env): boolean {
  return getRtxAppId(env) !== null;
}

export function getPreferredPort(
  fallback = 3000,
  env: EnvLike = process.env
): number {
  const raw = env.RTX_PORT ?? env.PORT;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the RealTimeX Main App API base URL.
 * Returns null in standalone mode when no RTX env is present.
 */
export function resolveRtxApiBase(env: EnvLike = process.env): string | null {
  for (const key of API_BASE_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return stripTrailingSlash(value);
  }

  if (!isRtxEmbedded(env)) return null;

  const port = env.SERVER_PORT?.trim() || "3001";
  return `http://127.0.0.1:${port}`;
}
