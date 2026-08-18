import { getPreferredPort, type EnvLike } from "@/lib/rtx/env";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Derive the Signals Local App base URL from an incoming HTTP request.
 * Uses the request origin so dynamic Local App ports match the brief the agent receives.
 */
export function resolveSignalsBaseUrlFromRequest(
  request: Request,
  env: EnvLike = process.env
): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const proto = forwardedProto || "http";
    return stripTrailingSlash(`${proto}://${forwardedHost}`);
  }

  try {
    return stripTrailingSlash(new URL(request.url).origin);
  } catch {
    return resolveSignalsBaseUrlFromEnv(env);
  }
}

/**
 * Fallback when no HTTP request is available (tests, background jobs).
 */
export function resolveSignalsBaseUrlFromEnv(env: EnvLike = process.env): string {
  const port = getPreferredPort(3000, env);
  return `http://127.0.0.1:${port}`;
}
