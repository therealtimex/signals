import type { EnvLike } from "@/lib/rtx/env";
import { createBrowserSessionApiClient } from "@/lib/browser/rtx-publish/browser-session-client";
import type { BrowserSessionApiClient } from "@/lib/browser/rtx-publish/browser-session-client";

/**
 * Embedded Local App browser-session client (`x-app-id` HTTP API).
 * Approved v1.1 §4.3 — pp-cli is not wired into the publish executor.
 */
export function createBrowserSessionClient(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): BrowserSessionApiClient {
  return createBrowserSessionApiClient(env, fetchImpl);
}
