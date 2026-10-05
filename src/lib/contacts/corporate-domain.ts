import { extractEmailDomain, isFreemailDomain } from "@/lib/platforms/gmail/email-domain";

/**
 * Free-mail brands that issue per-country domains (yahoo.fr, hotmail.co.uk, outlook.com.vn),
 * which `FREEMAIL_DOMAINS` lists only in their .com form.
 */
const FREEMAIL_BRANDS = new Set([
  "gmail",
  "googlemail",
  "yahoo",
  "ymail",
  "rocketmail",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "aol",
  "icloud",
  "gmx",
  "yandex",
  "proton",
  "protonmail",
  "zoho",
]);

/** Single-domain consumer providers common in APAC. */
const REGIONAL_FREEMAIL_DOMAINS = new Set([
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "mail.ru",
]);

const IP_LITERAL = /^\[?[\d.:]+\]?$/;

/**
 * The contact's employer domain from their email, or null (#534, ADR-534-6).
 *
 * Null when there is no email, the domain is free mail, has no dot, or is an IP
 * literal. Ambiguity resolves to null, which only means generic prompt copy and
 * no domain line in the research brief; nothing is automated off this value.
 */
export function corporateEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = extractEmailDomain(email);
  if (!domain || !domain.includes(".") || IP_LITERAL.test(domain)) return null;
  if (isFreemailDomain(domain) || REGIONAL_FREEMAIL_DOMAINS.has(domain)) return null;
  if (FREEMAIL_BRANDS.has(domain.split(".")[0] ?? "")) return null;
  return domain;
}
