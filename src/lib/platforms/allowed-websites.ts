import { dedupeOrigins, sameOriginSet } from "@/lib/browser/allowed-origins";
import type {
  AllowedOriginsChange,
  AllowedOriginsRuntime,
  AllowedOriginsView,
} from "@/lib/browser/allowed-websites-types";
import { listConnectionOrigins } from "@/lib/db/queries/browser-connection-origins";
import { getBrowserConnectionBySessionName } from "@/lib/db/queries/platform-targets";
import type { BrowserConnection } from "@/lib/db/types";
import { ExternalEffectDeniedError } from "@/lib/instance/guard";
import { buildDefaultAllowedOrigins } from "@/lib/platforms/platform-urls";
import {
  createRtxBrowserSession,
  findRtxBrowserSession,
  listRtxBrowserSessions,
  type RtxBrowserSessionGuardrails,
} from "@/lib/rtx/browser-sessions";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";

/**
 * A connection's allowed websites: the Signals defaults plus what the user added (ADR-547-2).
 * Read-only: a session without a `browser_connections` row gets the defaults, and nothing here
 * creates one.
 */
export function buildEffectiveAllowedOrigins(sessionName: string): string[] {
  const connection = getBrowserConnectionBySessionName(sessionName.trim());
  const custom = connection ? listConnectionOrigins(connection.id).map((row) => row.origin) : [];
  return dedupeOrigins([...buildDefaultAllowedOrigins(), ...custom]);
}

/**
 * Guardrails Signals declares for a connection's session on every connect and every apply. RTX
 * replaces each key it receives and keeps the others (ADR-547-1), so the list is always complete
 * and `primaryOrigin`, `allowNewTab` and `allowCloseTab` are never sent.
 */
export function buildConnectionGuardrails(sessionName: string): RtxBrowserSessionGuardrails {
  return {
    mode: "unrestricted",
    allowedOrigins: buildEffectiveAllowedOrigins(sessionName),
    blockedOrigins: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What RealTimeX holds for the session, compared with `effective`. `null` when standalone. */
export async function readAllowedOriginsRuntime(
  sessionName: string,
  effective: string[],
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsRuntime | null> {
  if (!isRtxEmbedded(env)) return null;

  let entry;
  try {
    entry = findRtxBrowserSession(await listRtxBrowserSessions(env, fetchImpl), sessionName);
  } catch (error) {
    return { reachable: false, allowedOrigins: null, applied: null, error: errorMessage(error) };
  }

  const held = entry?.guardrails?.allowedOrigins;
  if (!Array.isArray(held)) {
    return { reachable: true, allowedOrigins: null, applied: null };
  }
  const allowedOrigins = dedupeOrigins(held.filter((value): value is string => typeof value === "string"));
  // Equal, not a superset: after a failed removal RealTimeX still opens the removed website.
  return { reachable: true, allowedOrigins, applied: sameOriginSet(effective, allowedOrigins) };
}

/**
 * Re-declare the connection's full guardrails on RealTimeX, then read them back. `applied` is
 * true only when RealTimeX holds exactly the effective list. Never sends a `url`, so it never
 * starts the session or opens a tab, and the profile and its sign-ins are untouched.
 */
export async function applyConnectionAllowedOrigins(
  sessionName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsChange> {
  const guardrails = buildConnectionGuardrails(sessionName);
  const effective = guardrails.allowedOrigins;
  if (!isRtxEmbedded(env)) {
    return { applied: false, effective, runtime: null };
  }

  let applyError: string | undefined;
  try {
    await createRtxBrowserSession({ sessionName, guardrails }, env, fetchImpl);
  } catch (error) {
    if (error instanceof ExternalEffectDeniedError) throw error;
    applyError = errorMessage(error);
  }

  const runtime = await readAllowedOriginsRuntime(sessionName, effective, env, fetchImpl);
  const applied = !applyError && runtime?.applied === true;
  return {
    applied,
    effective,
    runtime,
    ...(applied
      ? {}
      : {
          error:
            applyError ??
            runtime?.error ??
            "The RealTimeX Browser didn't report the updated list of allowed websites.",
        }),
  };
}

export async function buildAllowedOriginsView(
  connection: BrowserConnection,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsView> {
  const rows = listConnectionOrigins(connection.id);
  const defaults = buildDefaultAllowedOrigins();
  const effective = dedupeOrigins([...defaults, ...rows.map((row) => row.origin)]);
  return {
    connectionId: connection.id,
    sessionName: connection.sessionName,
    defaults,
    custom: rows.map((row) => ({ origin: row.origin, source: row.source, addedAt: row.createdAt })),
    effective,
    runtime: await readAllowedOriginsRuntime(connection.sessionName, effective, env, fetchImpl),
  };
}
