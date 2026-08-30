import { isRedundantHeadline } from "@/lib/contact-detail-format";

export type ContactWebResearchQueryInput = {
  name: string;
  company?: string | null;
  title?: string | null;
  headline?: string | null;
  location?: string | null;
};

function clean(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
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

  const location = clean(input.location);
  if (location && parts.length < 4) parts.push(location);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildContactWebResearchRefinedQuery(
  name: string,
  company?: string | null,
): string {
  return [clean(name), clean(company)]
    .filter(Boolean)
    .map((part) => `"${part.replaceAll('"', "").trim()}"`)
    .concat("linkedin")
    .join(" ");
}

export function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
