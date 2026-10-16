/**
 * A RealTimeX Browser navigation refused by the session's allowed websites (#547, ADR-547-7).
 * Pure and client-safe: the run page, the formatter and the server all read denials this way.
 */
import { normalizeAllowedOrigin } from "@/lib/browser/allowed-origins";

export const RTX_NAVIGATION_BLOCKED = "RTX_NAVIGATION_BLOCKED" as const;

/** The reason RealTimeX gives when a session's allowed websites don't include the target. */
export const GUARDRAIL_ORIGIN_NOT_ALLOWED = "guardrail-origin-not-allowed";

/** One wire shape for REST bodies, workflow errors and agent tools. */
export type NavigationBlockedDenial = {
  code: typeof RTX_NAVIGATION_BLOCKED;
  reason: string;
  action: string | null;
  sessionName: string | null;
  /** The `browser_connections` row for `sessionName`; `null` when Signals doesn't manage it. */
  connectionId: string | null;
  deniedOrigin: string;
  requestedUrl: string | null;
  recoverable: boolean;
  recovery: { kind: "allow_origin"; connectionId: string; origin: string } | null;
};

/** What a raw error string says about a denial, before the server resolves its connection. */
export type ParsedNavigationDenial = {
  reason: string;
  action: string | null;
  sessionName: string | null;
  deniedOrigin: string;
  requestedUrl: string | null;
};

const PLAIN_DENIAL = /RealTimeX Browser session does not allow (https?:\/\/[^\s"'<>]+)/;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonDenial(raw: string): ParsedNavigationDenial | null {
  const marker = raw.indexOf(`${RTX_NAVIGATION_BLOCKED}:`);
  if (marker < 0) return null;
  const start = raw.indexOf("{", marker);
  if (start < 0) return null;

  // The JSON may be followed by more text; try each closing brace from the last one back.
  for (let end = raw.lastIndexOf("}"); end > start; end = raw.lastIndexOf("}", end - 1)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const origin = normalizeAllowedOrigin(record.deniedOrigin ?? record.requestedUrl);
    if (!origin.ok) return null;
    const requested = stringOrNull(record.requestedUrl);
    return {
      reason: stringOrNull(record.reason) ?? GUARDRAIL_ORIGIN_NOT_ALLOWED,
      action: stringOrNull(record.action),
      sessionName: stringOrNull(record.sessionName),
      deniedOrigin: origin.origin,
      requestedUrl: requested && normalizeAllowedOrigin(requested).ok ? requested : null,
    };
  }
  return null;
}

/**
 * Read a denial from a raw error: the canonical `RTX_NAVIGATION_BLOCKED:<json>` form, or the plain
 * text RealTimeX returns today ("The RealTimeX Browser session does not allow https://lnkd.in.").
 * Returns `null` for anything else, including the "is locked to" and "blocks" denials.
 */
export function parseNavigationDenial(raw: string): ParsedNavigationDenial | null {
  const fromJson = parseJsonDenial(raw);
  if (fromJson) return fromJson;

  const match = raw.match(PLAIN_DENIAL);
  if (!match) return null;
  const origin = normalizeAllowedOrigin(match[1].replace(/[.,;:)\]]+$/, ""));
  if (!origin.ok) return null;
  return {
    reason: GUARDRAIL_ORIGIN_NOT_ALLOWED,
    action: null,
    sessionName: null,
    deniedOrigin: origin.origin,
    requestedUrl: null,
  };
}

/** A denial found on a workflow run, with the raw error strings it came from. */
export type RunNavigationDenial = NavigationBlockedDenial & { sources: string[] };

/**
 * The session facts the formatter needs for one raw run error: which session was denied, and
 * whether Signals manages it. `undefined` when the error isn't one of the run's denials.
 */
export function navigationContextFor(
  raw: string,
  denials: readonly RunNavigationDenial[] | undefined,
): { navigation: { sessionName: string | null; managed: boolean } } | undefined {
  const denial = denials?.find((candidate) => candidate.sources.includes(raw));
  if (!denial) return undefined;
  return {
    navigation: { sessionName: denial.sessionName, managed: denial.connectionId !== null },
  };
}
