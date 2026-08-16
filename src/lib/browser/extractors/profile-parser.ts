import type { RawProfileData, ParsedProfileData } from "@/lib/browser/types";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/;
const TITLE_AT_COMPANY_RE =
  /\b([A-Za-z][A-Za-z0-9\s/&.-]{1,48}?)\s+(?:@|at)\s+([A-Za-z0-9][A-Za-z0-9\s.&'-]{1,48})/i;
const EX_COMPANY_RE = /\b(?:ex[-\s]?|former(?:ly)?\s+(?:at|@)?)\s*@?([A-Za-z0-9][A-Za-z0-9\s.&'-]{1,48})/gi;
const HASHTAG_RE = /#([A-Za-z][A-Za-z0-9_]{1,31})/g;

const SKILL_KEYWORDS = new Set([
  "ai",
  "ml",
  "react",
  "typescript",
  "javascript",
  "python",
  "rust",
  "golang",
  "kubernetes",
  "aws",
  "product",
  "design",
  "marketing",
  "sales",
  "founder",
  "engineering",
  "devops",
  "data",
  "security",
  "blockchain",
  "saas",
  "startup",
]);

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function collectText(raw: RawProfileData): string {
  return [
    raw.displayName,
    raw.bio,
    raw.location,
    raw.website,
    raw.pinnedTweetText,
    ...raw.recentTweetTexts,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractHashtags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_RE)) {
    const tag = match[1];
    if (tag) tags.push(tag.replace(/_/g, " "));
  }
  return uniqueStrings(tags);
}

function extractTitleAndCompany(bio: string | null): { title: string | null; company: string | null } {
  if (!bio) return { title: null, company: null };
  const match = bio.match(TITLE_AT_COMPANY_RE);
  if (!match) return { title: null, company: null };
  return {
    title: match[1]?.trim() ?? null,
    company: match[2]?.trim() ?? null,
  };
}

function extractPreviousCompanies(text: string): string[] {
  const companies: string[] = [];
  for (const match of text.matchAll(EX_COMPANY_RE)) {
    const company = match[1]?.trim();
    if (company) companies.push(company);
  }
  return uniqueStrings(companies);
}

function buildHeadline(raw: RawProfileData, title: string | null, company: string | null): string | null {
  if (title && company) return `${title} at ${company}`;
  if (raw.bio) {
    const firstLine = raw.bio.split(/\n|\. /)[0]?.trim();
    if (firstLine && firstLine.length <= 120) return firstLine;
  }
  return raw.displayName;
}

function classifyTags(tags: string[]): { skills: string[]; interests: string[] } {
  const skills: string[] = [];
  const interests: string[] = [];
  for (const tag of tags) {
    const normalized = tag.toLowerCase();
    if (SKILL_KEYWORDS.has(normalized) || normalized.includes("engineer")) {
      skills.push(tag);
    } else {
      interests.push(tag);
    }
  }
  return { skills, interests };
}

function scoreConfidence(parsed: Omit<ParsedProfileData, "confidence">): number {
  const fields = [
    parsed.company,
    parsed.title,
    parsed.headline,
    parsed.email,
    parsed.phone,
    parsed.industry,
    parsed.skills.length > 0 ? "skills" : null,
    parsed.interests.length > 0 ? "interests" : null,
    parsed.previousCompanies.length > 0 ? "previous" : null,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.min(1, filled / 6);
}

/**
 * Parse raw scraped profile data into structured contact fields using heuristics.
 * LLM extraction was removed with the Vercel AI SDK (#4); enrichment agents can
 * refine results via the agent-tools API.
 */
export async function parseProfile(raw: RawProfileData): Promise<ParsedProfileData> {
  const text = collectText(raw);
  const { title, company } = extractTitleAndCompany(raw.bio);
  const emailMatch = text.match(EMAIL_RE);
  const phoneMatch = text.match(PHONE_RE);
  const tags = extractHashtags(text);
  const { skills, interests } = classifyTags(tags);
  const previousCompanies = extractPreviousCompanies(text);

  const parsed: ParsedProfileData = {
    company,
    title,
    headline: buildHeadline(raw, title, company),
    email: emailMatch?.[0] ?? null,
    phone: phoneMatch?.[0] ?? null,
    skills,
    interests,
    previousCompanies,
    industry: null,
    confidence: 0,
  };

  parsed.confidence = scoreConfidence(parsed);
  return parsed;
}
