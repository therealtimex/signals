import { isRedundantHeadline } from "@/lib/contact-detail-format";
import { formatPlatformHandle } from "@/lib/contact-identity-handle";

export type ContactWebResearchQueryIdentityInput = {
  platform: string;
  platformHandle?: string | null;
  isActive?: number | boolean;
};

export type ContactWebResearchQueryInput = {
  name: string;
  company?: string | null;
  title?: string | null;
  headline?: string | null;
  location?: string | null;
  identities?: readonly ContactWebResearchQueryIdentityInput[];
};

function clean(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function activeIdentityTerms(input: ContactWebResearchQueryInput): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const identity of input.identities ?? []) {
    if (identity.isActive === false || identity.isActive === 0) continue;
    const handle = clean(identity.platformHandle);
    if (!handle) continue;
    const formatted = formatPlatformHandle(identity.platform, handle);
    const searchTerm =
      identity.platform === "linkedin" ? formatted.replace(/^\/?in\//i, "") : formatted;
    const key = searchTerm.toLowerCase();
    if (!searchTerm || seen.has(key)) continue;
    seen.add(key);
    terms.push(searchTerm);
  }

  return terms;
}

export function buildContactWebResearchQuery(input: ContactWebResearchQueryInput): string {
  const parts: string[] = [];
  const name = clean(input.name);
  const company = clean(input.company);
  const title = clean(input.title);
  const headline = clean(input.headline);

  if (name) parts.push(name);
  if (company && title) {
    parts.push(`${company} · ${title}`);
  } else if (company) {
    parts.push(company);
  } else if (title) {
    parts.push(title);
  }

  if (headline && !isRedundantHeadline(headline, title, company)) {
    parts.push(headline);
  }

  const identityTerms = activeIdentityTerms(input);
  if (identityTerms.length > 0) parts.push(identityTerms.join(" "));

  const location = clean(input.location);
  if (location && parts.length < 4) parts.push(location);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildContactWebResearchRefinedQuery(
  input: ContactWebResearchQueryInput,
): string {
  return [clean(input.name), clean(input.company), ...activeIdentityTerms(input)]
    .filter(Boolean)
    .map((part) => `"${part.replaceAll('"', "").trim()}"`)
    .concat("linkedin")
    .join(" ");
}

export function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
