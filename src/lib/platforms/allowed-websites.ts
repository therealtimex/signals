import {
  classifyOrigin,
  dedupeOrigins,
  normalizeAllowedOrigin,
  sameOriginSet,
} from "@/lib/browser/allowed-origins";
import type {
  AddAllowedOriginResult,
  AllowedOriginsChange,
  AllowedOriginsErrorBody,
  AllowedOriginsRuntime,
  AllowedOriginsView,
  RemoveAllowedOriginResult,
} from "@/lib/browser/allowed-websites-types";
import {
  GUARDRAIL_ORIGIN_NOT_ALLOWED,
  RTX_NAVIGATION_BLOCKED,
  type NavigationBlockedDenial,
} from "@/lib/browser/navigation-blocked";
import {
  addConnectionOrigin,
  listConnectionOrigins,
  removeConnectionOrigin,
  type BrowserConnectionOriginSource,
} from "@/lib/db/queries/browser-connection-origins";
import { getBrowserConnectionBySessionName } from "@/lib/db/queries/platform-targets";
import type { BrowserConnection } from "@/lib/db/types";
import { ExternalEffectDeniedError } from "@/lib/instance/guard";
import { buildDefaultAllowedOrigins } from "@/lib/platforms/platform-urls";
import {
  assertPublishSessionEffectAllowed,
  createRtxBrowserSession,
  findRtxBrowserSession,
  listRtxBrowserSessions,
  type RtxBrowserSessionGuardrails,
  type RtxNavigationBlockedError,
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

export type AllowedOriginsRouteFailure = { ok: false; status: 400; body: AllowedOriginsErrorBody };

const ERROR_TEXT: Record<AllowedOriginsErrorBody["code"], string> = {
  invalid_url: "Enter a full link that starts with https:// or http://.",
  unsupported_scheme: "Only websites that start with https:// or http:// can be allowed.",
  credentials_not_allowed: "Remove the username and password from the link, then add it again.",
  default_origin: "Signals always allows this website, so it can't be removed.",
  not_found: "Browser connection not found.",
};

export function allowedOriginsError(code: AllowedOriginsErrorBody["code"]): AllowedOriginsErrorBody {
  return { code, error: ERROR_TEXT[code] };
}

function currentChange(
  runtime: AllowedOriginsRuntime | null,
  effective: string[],
): AllowedOriginsChange {
  return { applied: runtime?.applied === true, effective, runtime };
}

/**
 * Allow the website a pasted link belongs to (ADR-547-6): normalize → guard → persist → apply →
 * verify. The Dev-instance guard runs before anything is saved, so a Dev database never collects
 * websites RealTimeX will never see. A website Signals already allows, or one already in the list,
 * is reported without a write.
 */
export async function addAllowedOrigin(
  connection: BrowserConnection,
  input: { url: unknown; source: BrowserConnectionOriginSource },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsRouteFailure | { ok: true; result: AddAllowedOriginResult }> {
  const normalized = normalizeAllowedOrigin(input.url);
  if (!normalized.ok) return { ok: false, status: 400, body: allowedOriginsError(normalized.code) };
  assertPublishSessionEffectAllowed(connection.sessionName, env);

  const origin = normalized.origin;
  const defaults = buildDefaultAllowedOrigins();
  const custom = listConnectionOrigins(connection.id).map((row) => row.origin);
  const known = classifyOrigin(origin, defaults, custom);
  if (known !== "new") {
    const effective = dedupeOrigins([...defaults, ...custom]);
    const runtime = await readAllowedOriginsRuntime(connection.sessionName, effective, env, fetchImpl);
    return {
      ok: true,
      result: {
        origin,
        status: known === "default" ? "already_default" : "already_added",
        persisted: true,
        ...currentChange(runtime, effective),
      },
    };
  }

  addConnectionOrigin({ connectionId: connection.id, origin, source: input.source });
  const change = await applyConnectionAllowedOrigins(connection.sessionName, env, fetchImpl);
  return { ok: true, result: { origin, status: "added", persisted: true, ...change } };
}

/** Remove a website the user added. Signals defaults can't be removed. */
export async function removeAllowedOrigin(
  connection: BrowserConnection,
  rawOrigin: unknown,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsRouteFailure | { ok: true; result: RemoveAllowedOriginResult }> {
  const normalized = normalizeAllowedOrigin(rawOrigin);
  if (!normalized.ok) return { ok: false, status: 400, body: allowedOriginsError(normalized.code) };
  const origin = normalized.origin;
  if (buildDefaultAllowedOrigins().includes(origin)) {
    return { ok: false, status: 400, body: allowedOriginsError("default_origin") };
  }
  assertPublishSessionEffectAllowed(connection.sessionName, env);

  if (!removeConnectionOrigin(connection.id, origin)) {
    const effective = buildEffectiveAllowedOrigins(connection.sessionName);
    const runtime = await readAllowedOriginsRuntime(connection.sessionName, effective, env, fetchImpl);
    return { ok: true, result: { origin, removed: false, ...currentChange(runtime, effective) } };
  }
  const change = await applyConnectionAllowedOrigins(connection.sessionName, env, fetchImpl);
  return { ok: true, result: { origin, removed: true, ...change } };
}

/** Re-apply the saved list to RealTimeX and read it back: the retry for "not active yet". */
export async function reapplyAllowedOrigins(
  connection: BrowserConnection,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AllowedOriginsChange> {
  assertPublishSessionEffectAllowed(connection.sessionName, env);
  return applyConnectionAllowedOrigins(connection.sessionName, env, fetchImpl);
}

/** HTTP status for a change: 502 when RealTimeX is there but didn't take the list. */
export function allowedOriginsChangeStatus(change: AllowedOriginsChange): 200 | 502 {
  return change.runtime && !change.applied ? 502 : 200;
}

/** The wire body for a navigation RealTimeX refused, with the connection resolved (ADR-547-7). */
export function navigationBlockedBody(error: RtxNavigationBlockedError): NavigationBlockedDenial {
  const { reason, action, sessionName, deniedOrigin, requestedUrl } = error.denial;
  const connection = sessionName ? getBrowserConnectionBySessionName(sessionName) : undefined;
  const managed = connection && connection.status === "active" ? connection : null;
  const recoverable = reason === GUARDRAIL_ORIGIN_NOT_ALLOWED && managed !== null;
  return {
    code: RTX_NAVIGATION_BLOCKED,
    reason,
    action,
    sessionName,
    connectionId: managed?.id ?? null,
    deniedOrigin,
    requestedUrl,
    recoverable,
    recovery:
      recoverable && managed
        ? { kind: "allow_origin", connectionId: managed.id, origin: deniedOrigin }
        : null,
  };
}
