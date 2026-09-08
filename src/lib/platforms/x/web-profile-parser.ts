import * as cheerio from "cheerio";

const X_RESERVED_HANDLES = new Set([
  "home", "i", "explore", "search", "login", "signup", "notifications",
  "messages", "settings", "tos", "privacy", "about", "intent", "share",
  "hashtag", "compose", "account", "flow",
]);

export type XWebProfile = {
  /** Absent on anonymous renders of accounts that publish no banner. See `readBannerUserId`. */
  id?: string;
  handle: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
  canonicalUrl?: string;
  location?: string;
  websiteUrl?: string;
  createdAt?: string;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
};

export type XWebParseResult =
  | { status: "ok"; profile: XWebProfile }
  | { status: "shell" }
  | { status: "suspended" }
  | { status: "not_found" }
  | { status: "parse_failed"; reason: string };

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findProfilePerson(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProfilePerson(item);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;

  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Person")) return record;

  for (const key of ["mainEntity", "author", "@graph"]) {
    const found = findProfilePerson(record[key]);
    if (found) return found;
  }
  return null;
}

function readIdentifier(person: JsonRecord): string | undefined {
  const direct = asString(person.identifier);
  if (direct && /^\d+$/.test(direct)) return direct;
  const record = asRecord(person.identifier);
  const nested = asString(record?.value) ?? asString(record?.identifier);
  return nested && /^\d+$/.test(nested) ? nested : undefined;
}

function validHandle(value: unknown): string | undefined {
  const handle = asString(value)?.replace(/^@/, "");
  return handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) && !X_RESERVED_HANDLES.has(handle.toLowerCase())
    ? handle
    : undefined;
}

function readImage(person: JsonRecord): string | undefined {
  const image = asRecord(person.image);
  const raw = asString(image?.contentUrl) ?? asString(image?.thumbnailUrl) ?? asString(person.image);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // The default egg lives on abs.twimg.com and banners share the pbs origin; neither is an avatar.
    if (url.origin !== "https://pbs.twimg.com" || !url.pathname.startsWith("/profile_images/")) {
      return undefined;
    }
    url.pathname = url.pathname.replace(/_(?:normal|200x200|400x400|bigger)(?=\.[^.]+$)/, "_normal");
    return url.href;
  } catch {
    return undefined;
  }
}

function readLocation(person: JsonRecord): string | undefined {
  return asString(asRecord(person.homeLocation)?.name) ?? asString(person.homeLocation);
}

function readWebsite(person: JsonRecord): string | undefined {
  const candidates = Array.isArray(person.sameAs) ? person.sameAs : [person.sameAs, person.url];
  for (const value of candidates) {
    const raw = asString(value);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!['x.com', 'twitter.com', 'mobile.x.com'].includes(url.hostname.toLowerCase())) return url.href;
    } catch {
      // Ignore malformed optional URLs.
    }
  }
  return undefined;
}

function readCounts(person: JsonRecord): Pick<XWebProfile, "followersCount" | "followingCount" | "tweetCount"> {
  const result: Pick<XWebProfile, "followersCount" | "followingCount" | "tweetCount"> = {};
  const stats = Array.isArray(person.interactionStatistic)
    ? person.interactionStatistic
    : [person.interactionStatistic];
  for (const value of stats) {
    const stat = asRecord(value);
    if (!stat) continue;
    const count = Number(stat.userInteractionCount ?? stat.value);
    if (!Number.isFinite(count) || count < 0) continue;
    const interaction = asRecord(stat.interactionType);
    const label = [stat.name, stat.description, interaction?.name, interaction?.["@type"]]
      .map((item) => asString(item)?.toLowerCase() ?? "")
      .join(" ");
    if (label.includes("follower") || label.split(/\s+/).includes("follows")) {
      result.followersCount = count;
    }
    else if (label.includes("following") || label.includes("friend")) result.followingCount = count;
    else if (label.includes("tweet") || label.includes("post")) result.tweetCount = count;
  }
  return result;
}

const X_PROFILE_BANNER_PATTERN = /^https:\/\/pbs\.twimg\.com\/profile_banners\/(\d+)\//;

const X_JOIN_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function metaContent($: cheerio.CheerioAPI, key: string): string | undefined {
  return asString($(`meta[property="${key}"], meta[name="${key}"]`).first().attr("content"));
}

/**
 * Anonymous profile markup carries no numeric user ID, but the banner URL X puts in
 * `twitter:image` is keyed by it. Both IDs extracted this way round-trip: navigating
 * `https://x.com/i/user/<id>` redirects back to the same handle. Accounts without a banner
 * publish no `twitter:image` at all, so the ID stays optional.
 */
function readBannerUserId($: cheerio.CheerioAPI): string | undefined {
  const raw = metaContent($, "twitter:image");
  return raw ? X_PROFILE_BANNER_PATTERN.exec(raw)?.[1] : undefined;
}

/**
 * `twitter:label2`/`twitter:data2` carry "Joined" / "December 2012". Month precision only, so
 * callers must treat this as a gap-filler and never overwrite an exact API timestamp with it.
 */
function readJoinDate($: cheerio.CheerioAPI): string | undefined {
  if (metaContent($, "twitter:label2")?.toLowerCase() !== "joined") return undefined;
  const parts = metaContent($, "twitter:data2")?.trim().split(/\s+/);
  if (parts?.length !== 2) return undefined;
  const month = X_JOIN_MONTHS.indexOf(parts[0].toLowerCase());
  const year = Number(parts[1]);
  if (month < 0 || !Number.isInteger(year) || year < 2006 || year > 2100) return undefined;
  return new Date(Date.UTC(year, month, 1)).toISOString();
}

function readMicrodataPerson($: cheerio.CheerioAPI): JsonRecord | null {
  const profilePage = $('[itemtype="https://schema.org/ProfilePage"]').first();
  const person = profilePage
    .find('[itemprop="mainEntity"][itemtype="https://schema.org/Person"]')
    .first();
  if (!person.length) return null;

  const directMeta = (property: string) => asString(
    person.children(`[itemprop="${property}"]`).first().attr("content"),
  );
  const image = person.children('[itemprop="image"]').first();
  const location = person.children('[itemprop="homeLocation"]').first();
  const interactionStatistic: JsonRecord[] = [];
  person.children('[itemprop="interactionStatistic"]').each((_index, element) => {
    const statistic = $(element);
    interactionStatistic.push({
      name: statistic.find('[itemprop="name"]').first().attr("content"),
      interactionType: statistic.find('[itemprop="interactionType"]').first().attr("content"),
      userInteractionCount: statistic.find('[itemprop="userInteractionCount"]').first().attr("content"),
    });
  });

  return {
    "@type": "Person",
    identifier: directMeta("identifier"),
    additionalName: directMeta("alternateName"),
    name: directMeta("name"),
    description: directMeta("description"),
    url: directMeta("url"),
    sameAs: directMeta("sameAs"),
    dateCreated: asString(profilePage.children('[itemprop="dateCreated"]').first().attr("content")),
    homeLocation: { name: location.find('[itemprop="name"]').first().attr("content") },
    image: {
      contentUrl: image.find('[itemprop="contentUrl"]').first().attr("content"),
      thumbnailUrl: image.find('[itemprop="thumbnailUrl"]').first().attr("content"),
    },
    interactionStatistic,
  };
}

function classifyTerminalPage(text: string): "suspended" | "not_found" | null {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  if (normalized.includes("account suspended") || normalized.includes("account is suspended")) {
    return "suspended";
  }
  if (
    normalized.includes("user profile not found") ||
    normalized.includes("this account doesn't exist") ||
    normalized.includes("account doesn't exist") ||
    normalized.includes("page doesn't exist")
  ) {
    return "not_found";
  }
  return null;
}

export function parseCanonicalXProfileUrl(rawUrl: string): { handle: string } | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://x.com" || url.username || url.password || url.port) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    const handle = validHandle(segments[0]);
    return handle ? { handle } : null;
  } catch {
    return null;
  }
}

export function parseXWebProfile(html: string): XWebParseResult {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return { status: "parse_failed", reason: "invalid_html" };
  }

  const visibleText = [$("title").text(), metaContent($, "og:title"), metaContent($, "og:description"), $("body").text()].join(" ");
  const terminal = classifyTerminalPage(visibleText);
  if (terminal) return { status: terminal };

  let person: JsonRecord | null = null;
  $('script[type="application/ld+json"]').each((_index, element) => {
    if (person) return;
    try {
      person = findProfilePerson(JSON.parse($(element).text()));
    } catch {
      // Malformed JSON-LD falls through to other blocks and metadata.
    }
  });
  const profilePerson = (person as JsonRecord | null) ?? readMicrodataPerson($);

  const canonicalRaw = asString($('link[rel="canonical"]').first().attr("href"));
  const canonical = canonicalRaw ? parseCanonicalXProfileUrl(canonicalRaw) : null;
  const ogTitle = metaContent($, "og:title") ?? metaContent($, "twitter:title");
  const ogMatch = ogTitle?.match(/^(.*?)\s*\(@([A-Za-z0-9_]{1,15})\)/);
  const id = (profilePerson ? readIdentifier(profilePerson) : undefined) ?? readBannerUserId($);
  const handle = validHandle(profilePerson?.additionalName) ?? canonical?.handle ?? validHandle(ogMatch?.[2]);

  const hasProfileMetadata = !!profilePerson || !!canonical || !!ogMatch || !!metaContent($, "og:image");
  if (!hasProfileMetadata) return { status: "shell" };
  if (!handle) return { status: "parse_failed", reason: "missing_handle" };

  const personImage = profilePerson ? readImage(profilePerson) : undefined;
  const ogImage = metaContent($, "og:image") ?? metaContent($, "twitter:image");
  const avatarUrl = personImage ?? (ogImage ? readImage({ image: ogImage }) : undefined);
  const location = profilePerson ? readLocation(profilePerson) : undefined;
  const profile: XWebProfile = {
    id,
    handle,
    name: asString(profilePerson?.name) ?? asString(ogMatch?.[1]),
    description: asString(profilePerson?.description) ?? metaContent($, "og:description") ?? metaContent($, "twitter:description"),
    avatarUrl,
    canonicalUrl: canonical ? `https://x.com/${canonical.handle}` : `https://x.com/${handle}`,
    location,
    websiteUrl: profilePerson ? readWebsite(profilePerson) : undefined,
    createdAt: asString(profilePerson?.dateCreated) ?? readJoinDate($),
    ...(profilePerson ? readCounts(profilePerson) : {}),
  };
  return { status: "ok", profile };
}
