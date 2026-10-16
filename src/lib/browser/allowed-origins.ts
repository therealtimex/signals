/**
 * Allowed-website policy for browser connections (#547, ADR-547-5). Pure: no database, no RTX.
 *
 * `URL.origin` is the normalizer on purpose. RealTimeX compares `new URL(v).origin.toLowerCase()`
 * by exact string equality, so what Signals stores is the exact string RealTimeX matches against:
 * path, query and fragment dropped, host lowercased, default port dropped, IDN as punycode.
 */

export const ALLOWED_ORIGIN_ERROR_CODES = [
  "invalid_url",
  "unsupported_scheme",
  "credentials_not_allowed",
] as const;

export type AllowedOriginErrorCode = (typeof ALLOWED_ORIGIN_ERROR_CODES)[number];

export type NormalizedAllowedOrigin =
  | { ok: true; origin: string }
  | { ok: false; code: AllowedOriginErrorCode };

const INVALID: NormalizedAllowedOrigin = { ok: false, code: "invalid_url" };

/** Reduce a pasted absolute http(s) link to its origin, or say why it can't be allowed. */
export function normalizeAllowedOrigin(input: unknown): NormalizedAllowedOrigin {
  if (typeof input !== "string") return INVALID;
  const trimmed = input.trim();
  if (!trimmed) return INVALID;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return INVALID;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "unsupported_scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, code: "credentials_not_allowed" };
  }
  // WHATWG URL accepts `*` in a host, but RealTimeX matches origins exactly, so a wildcard would
  // be stored as a literal host that never matches anything.
  if (url.hostname === "" || url.origin === "null" || url.hostname.includes("*")) {
    return INVALID;
  }
  return { ok: true, origin: url.origin };
}

/** Normalize each entry and drop invalid ones and duplicates, keeping first-seen order. */
export function dedupeOrigins(origins: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of origins) {
    const normalized = normalizeAllowedOrigin(value);
    if (normalized.ok) seen.add(normalized.origin);
  }
  return [...seen];
}

export type OriginClass = "default" | "custom" | "new";

export function classifyOrigin(
  origin: string,
  defaults: readonly string[],
  custom: readonly string[],
): OriginClass {
  if (defaults.includes(origin)) return "default";
  if (custom.includes(origin)) return "custom";
  return "new";
}

/** True when `url`'s origin is exactly one of `effectiveOrigins`. Unparseable URLs are not allowed. */
export function isOriginAllowed(effectiveOrigins: readonly string[], url: string): boolean {
  const normalized = normalizeAllowedOrigin(url);
  return normalized.ok && effectiveOrigins.includes(normalized.origin);
}

/** Every origin in `expected` is present in `actual`, compared after normalization. */
export function originsIncluded(expected: readonly string[], actual: readonly string[]): boolean {
  const held = new Set(dedupeOrigins(actual));
  return dedupeOrigins(expected).every((origin) => held.has(origin));
}

/** Both lists hold the same origins, compared after normalization and ignoring order. */
export function sameOriginSet(a: readonly string[], b: readonly string[]): boolean {
  const left = dedupeOrigins(a);
  const right = dedupeOrigins(b);
  return left.length === right.length && originsIncluded(left, right);
}
