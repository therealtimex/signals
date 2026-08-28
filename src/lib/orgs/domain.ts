export type NormalizeDomainErrorCode =
  | "EMPTY"
  | "INVALID_HOSTNAME"
  | "NO_TLD"
  | "IP_ADDRESS"
  | "LOCAL";

export type NormalizeDomainResult =
  | { ok: true; domain: string }
  | { ok: false; code: NormalizeDomainErrorCode; message: string };

const DOMAIN_MESSAGE = "Enter a domain like acme.com.";

function invalid(code: NormalizeDomainErrorCode, message = DOMAIN_MESSAGE): NormalizeDomainResult {
  return { ok: false, code, message };
}

function isIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

/** Normalize a user-entered company domain without collapsing subdomains. */
export function normalizeOrgDomain(raw: string | null | undefined): NormalizeDomainResult {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return invalid("EMPTY", "Enter a company domain.");

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return invalid("INVALID_HOSTNAME");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalid("INVALID_HOSTNAME");
  }

  let domain = parsed.hostname.toLowerCase();
  if (domain.startsWith("www.")) domain = domain.slice(4);
  if (!domain) return invalid("INVALID_HOSTNAME");
  if (isIpv4(domain) || domain.includes(":")) {
    return invalid("IP_ADDRESS", "Use a company domain, not an IP address.");
  }
  if (domain === "localhost") {
    return invalid("LOCAL", "Use a public company domain, not localhost.");
  }

  const labels = domain.split(".");
  if (labels.length < 2) return invalid("NO_TLD", "Include a public suffix, such as .com.");
  if (
    labels.some(
      (label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.length > 63,
    )
  ) {
    return invalid("INVALID_HOSTNAME");
  }

  const tld = labels.at(-1)!;
  if (tld.length < 2) return invalid("INVALID_HOSTNAME");

  return { ok: true, domain };
}

export function requireNormalizedOrgDomain(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const result = normalizeOrgDomain(raw);
  if (!result.ok) {
    const error = new Error(result.message) as Error & { code?: NormalizeDomainErrorCode };
    error.code = result.code;
    throw error;
  }
  return result.domain;
}
