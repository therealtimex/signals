const LUMA_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);
const SECRET_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "authorization",
  "code",
  "invite",
  "invite_token",
  "key",
  "signature",
  "sig",
  "tk",
  "token",
]);
const NESTED_URL_KEYS = new Set(["continue", "destination", "next", "redirect", "redirect_uri", "return", "return_to", "url"]);

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function isSupportedLumaUrl(raw: string): boolean {
  const url = parseHttpUrl(raw);
  return Boolean(
    url &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      LUMA_HOSTS.has(url.hostname.toLowerCase()) &&
      url.pathname.split("/").filter(Boolean).length > 0,
  );
}

export function canonicalizeLumaUrl(raw: string): string | null {
  if (!isSupportedLumaUrl(raw)) return null;
  const url = new URL(raw.trim());
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function lumaEventKey(raw: string): string | null {
  // Until a provider-owned immutable ID is observed, the canonical URL itself is
  // the stable source key. A path slug is not proof of provider identity.
  return canonicalizeLumaUrl(raw);
}

function decodeNested(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

/** Remove credential-like query values without breaking functional announcement URLs. */
export function sanitizeExternalUrl(raw: string, depth = 0): string {
  const canonicalLuma = canonicalizeLumaUrl(raw);
  if (canonicalLuma) return canonicalLuma;
  const url = parseHttpUrl(raw);
  if (!url) return raw.trim();

  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (SECRET_QUERY_KEYS.has(normalized)) {
      url.searchParams.delete(key);
      continue;
    }
    if (depth < 2 && NESTED_URL_KEYS.has(normalized)) {
      const values = url.searchParams.getAll(key);
      url.searchParams.delete(key);
      for (const value of values) {
        const decoded = decodeNested(value);
        url.searchParams.append(key, sanitizeExternalUrl(decoded, depth + 1));
      }
    }
  }
  url.hash = "";
  return url.toString();
}
