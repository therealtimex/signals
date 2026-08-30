export type ContactSerpScoringInput = {
  name: string;
  company?: string | null;
  title?: string | null;
  website?: string | null;
};

export type SerpCandidate = {
  url: string;
  title?: string | null;
  snippet?: string | null;
  source?: "organic" | "ai_overview" | string;
};

export type ScoredSerpCandidate = SerpCandidate & {
  urlScore: number;
  textScore: number;
  totalScore: number;
  reason: string;
};

export type SerpCandidateScoreResult = {
  candidates: ScoredSerpCandidate[];
  ambiguous: boolean;
};

const NEWS_OR_DIRECTORY_HOSTS = [
  "bloomberg.com",
  "forbes.com",
  "reuters.com",
  "nytimes.com",
  "wsj.com",
  "yahoo.com",
  "zoominfo.com",
  "rocketreach.co",
  "signalhire.com",
  "theorg.com",
];

const ROLE_STOP_WORDS = new Set([
  "and",
  "at",
  "chief",
  "co",
  "of",
  "the",
]);

const COMPANY_STOP_WORDS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "group",
  "inc",
  "labs",
  "limited",
  "llc",
  "ltd",
  "technologies",
]);

function normalizedWords(value: string | null | undefined): string[] {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedText(value: string | null | undefined): string {
  return normalizedWords(value).join(" ");
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLinkedInProfile(url: URL): boolean {
  return /(^|\.)linkedin\.com$/.test(url.hostname) && /^\/in\//.test(url.pathname);
}

function isXProfile(url: URL): boolean {
  if (!/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return false;
  const segment = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return Boolean(segment && !["explore", "hashtag", "home", "i", "search", "share"].includes(segment));
}

function isProfileCandidate(url: URL | null): boolean {
  if (!url) return false;
  return (
    isLinkedInProfile(url) ||
    isXProfile(url) ||
    (/(^|\.)crunchbase\.com$/.test(url.hostname) && /^\/person\//.test(url.pathname)) ||
    /(^|\.)wikipedia\.org$/.test(url.hostname) ||
    /(^|\.)wikidata\.org$/.test(url.hostname)
  );
}

function hostnameMatchesCompany(
  url: URL,
  company: string | null | undefined,
  website: string | null | undefined,
): boolean {
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const websiteUrl = website ? safeUrl(website.includes("://") ? website : `https://${website}`) : null;
  if (websiteUrl) {
    const companyHost = websiteUrl.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === companyHost || hostname.endsWith(`.${companyHost}`)) return true;
  }

  const hostnameTokens = new Set(hostname.split(/[.-]/).filter(Boolean));
  const companyTokens = normalizedWords(company).filter(
    (token) => token.length >= 3 && !COMPANY_STOP_WORDS.has(token),
  );
  return companyTokens.some((token) => hostnameTokens.has(token));
}

function hasDifferentProfilePerson(candidateTitle: string, contactName: string): boolean {
  const titleLead = candidateTitle.split(/\s(?:[-–—|·])\s/)[0] ?? "";
  const leadWords = normalizedWords(titleLead).slice(0, 4);
  const nameWords = normalizedWords(contactName);
  if (leadWords.length < 2 || nameWords.length < 2) return false;
  const fullName = nameWords.join(" ");
  if (leadWords.join(" ").includes(fullName)) return false;
  return !nameWords.some((word) => leadWords.includes(word));
}

function scoreCandidate(
  contact: ContactSerpScoringInput,
  candidate: SerpCandidate,
): ScoredSerpCandidate {
  const url = safeUrl(candidate.url);
  const reasons: string[] = [];
  let urlScore = 0;
  let textScore = 0;

  if (url && isLinkedInProfile(url)) {
    urlScore += 100;
    reasons.push("linkedin /in/");
  } else if (url && isXProfile(url)) {
    urlScore += 80;
    reasons.push("X profile");
  } else if (url && hostnameMatchesCompany(url, contact.company, contact.website)) {
    urlScore += 70;
    reasons.push("company domain");
  } else if (
    url &&
    /(^|\.)crunchbase\.com$/.test(url.hostname) &&
    /^\/person\//.test(url.pathname)
  ) {
    urlScore += 50;
    reasons.push("Crunchbase person");
  } else if (
    url &&
    (/(^|\.)wikipedia\.org$/.test(url.hostname) || /(^|\.)wikidata\.org$/.test(url.hostname))
  ) {
    urlScore += 40;
    reasons.push("Wikipedia/Wikidata person");
  }

  if (
    url &&
    (NEWS_OR_DIRECTORY_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    ) || /\/(news|people|directory|search)\//.test(url.pathname.toLowerCase()))
  ) {
    urlScore -= 50;
    reasons.push("news/directory penalty");
  }

  const name = normalizedText(contact.name);
  const titleText = normalizedText(candidate.title);
  const snippetText = normalizedText(candidate.snippet);
  if (name && titleText.includes(name)) {
    textScore += 30;
    reasons.push("full name in title");
  }

  const companyWords = normalizedWords(contact.company).filter(
    (token) => token.length >= 3 && !COMPANY_STOP_WORDS.has(token),
  );
  if (companyWords.length > 0 && companyWords.every((word) => snippetText.includes(word))) {
    textScore += 25;
    reasons.push("company in snippet");
  }

  const roleWords = normalizedWords(contact.title).filter(
    (token) => token.length >= 2 && !ROLE_STOP_WORDS.has(token),
  );
  if (roleWords.some((word) => snippetText.includes(word))) {
    textScore += 15;
    reasons.push("role in snippet");
  }

  if (isProfileCandidate(url) && hasDifferentProfilePerson(candidate.title ?? "", contact.name)) {
    textScore -= 80;
    reasons.push("different-person penalty");
  }

  return {
    ...candidate,
    urlScore,
    textScore,
    totalScore: urlScore + textScore,
    reason: reasons.join("; ") || "no positive match signals",
  };
}

export function isSerpCandidateSetAmbiguous(
  candidates: ScoredSerpCandidate[],
  threshold = 60,
  tieWindow = 15,
): boolean {
  const eligible = candidates.filter((candidate) => candidate.totalScore >= threshold);
  if (eligible.length === 0) return true;
  if (eligible.length < 2) return false;

  const [first, second] = eligible;
  return (
    first.totalScore - second.totalScore <= tieWindow &&
    isProfileCandidate(safeUrl(first.url)) &&
    isProfileCandidate(safeUrl(second.url))
  );
}

export function scoreSerpCandidates(
  contact: ContactSerpScoringInput,
  candidates: SerpCandidate[],
): SerpCandidateScoreResult {
  const scored = candidates
    .map((candidate) => scoreCandidate(contact, candidate))
    .sort((left, right) => right.totalScore - left.totalScore || left.url.localeCompare(right.url));
  return { candidates: scored, ambiguous: isSerpCandidateSetAmbiguous(scored) };
}
