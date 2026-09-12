import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import {
  canonicalizeLumaUrl,
  lumaEventKey,
  sanitizeExternalUrl,
} from "@/lib/workflows/event-sources/urls";
import type {
  EventParty,
  EventRelationshipRole,
  EventSource,
  EventSourceEvidence,
} from "@/lib/workflows/event-sources/types";

export const LUMA_EXTRACTOR_VERSION = 2;

function stableObservationId(parts: string[]): string {
  return `obs_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findEventJsonLd(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findEventJsonLd(entry);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (record["@type"] === "Event" || (Array.isArray(record["@type"]) && record["@type"].includes("Event"))) {
    return record;
  }
  return findEventJsonLd(record["@graph"]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safePublicUrl(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const sanitized = sanitizeExternalUrl(raw);
  try {
    const parsed = new URL(sanitized);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return undefined;
    }
    return sanitized;
  } catch {
    return undefined;
  }
}

function schemaEntityType(value: unknown): EventParty["entityType"] {
  const values = Array.isArray(value) ? value : [value];
  const types = values.filter((entry): entry is string => typeof entry === "string");
  if (types.includes("Organization")) return "organization";
  if (types.includes("Person")) return "person";
  if (types.includes("Place")) return "place";
  return "unknown";
}

function personOrOrgName(value: unknown): Array<Pick<EventParty, "name" | "url" | "entityType">> {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ name: entry.trim(), entityType: "unknown" as const }];
    }
    const record = asRecord(entry);
    const name = stringValue(record?.name);
    if (!name) return [];
    const url = safePublicUrl(record?.url);
    return [{
      name,
      ...(url ? { url } : {}),
      entityType: schemaEntityType(record?.["@type"]),
    }];
  });
}

function locationLabel(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const record = asRecord(value);
  if (!record) return null;
  const address = asRecord(record.address);
  return stringValue(record.name) ?? stringValue(address?.streetAddress) ?? stringValue(address?.addressLocality);
}

function eventStatus(value: unknown, endsAt: string | null, observedAt: number): EventSource["status"] {
  const raw = stringValue(value)?.toLowerCase() ?? "";
  if (raw.includes("cancel")) return "cancelled";
  if (endsAt && Date.parse(endsAt) < observedAt * 1000) return "ended";
  return raw || endsAt ? "scheduled" : "unknown";
}

function readLumaNextPageData($: cheerio.CheerioAPI): Record<string, unknown> | null {
  const raw = $("script#__NEXT_DATA__").first().text();
  if (!raw.trim()) return null;
  try {
    const root = asRecord(JSON.parse(raw));
    const props = asRecord(root?.props);
    const pageProps = asRecord(props?.pageProps);
    const initialData = asRecord(pageProps?.initialData);
    return asRecord(initialData?.data);
  } catch {
    return null;
  }
}

function socialHandleUrl(
  platform: "instagram" | "linkedin" | "x" | "youtube",
  value: unknown,
): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return safePublicUrl(raw);
  if (platform === "linkedin") {
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    if (!/^\/(?:in|company)\/[a-z0-9._%-]+\/?$/i.test(path)) return undefined;
    return safePublicUrl(`https://www.linkedin.com${path}`);
  }
  const handle = raw.replace(/^@/, "");
  if (!/^[a-z0-9._-]{1,100}$/i.test(handle)) return undefined;
  if (platform === "x") return safePublicUrl(`https://x.com/${handle}`);
  if (platform === "instagram") return safePublicUrl(`https://www.instagram.com/${handle}`);
  return safePublicUrl(`https://www.youtube.com/@${handle}`);
}

function publicIdentityUrls(record: Record<string, unknown>): string[] {
  return [...new Set([
    safePublicUrl(record.website),
    socialHandleUrl("linkedin", record.linkedin_handle),
    socialHandleUrl("x", record.twitter_handle),
    socialHandleUrl("instagram", record.instagram_handle),
    socialHandleUrl("youtube", record.youtube_handle),
  ].filter((url): url is string => Boolean(url)))];
}

function embeddedCalendarUrl(
  data: Record<string, unknown> | null,
  canonicalUrl: string,
): string | null {
  const calendar = asRecord(data?.calendar);
  const slug = stringValue(calendar?.slug);
  if (!slug || !/^[a-z0-9_-]{1,160}$/i.test(slug)) return null;
  return canonicalizeLumaUrl(new URL(`/${slug}`, canonicalUrl).toString());
}

function addUniqueParty(parties: EventParty[], party: EventParty): void {
  const match = parties.find(
    (candidate) =>
      candidate.role === party.role
      && normalizedText(candidate.name).toLowerCase() === normalizedText(party.name).toLowerCase(),
  );
  if (!match) {
    parties.push(party);
    return;
  }
  const identityUrls = [...new Set([
    ...(match.identityUrls ?? []),
    ...(party.identityUrls ?? []),
  ])];
  if (!match.url && party.url) match.url = party.url;
  if (identityUrls.length > 0) match.identityUrls = identityUrls;
  if (match.entityType === "unknown" && party.entityType !== "unknown") {
    match.entityType = party.entityType;
  }
}

function partyFromPublicRecord(input: {
  record: Record<string, unknown>;
  role: EventRelationshipRole;
  canonicalUrl: string;
  observedAt: number;
  preferWebsite?: boolean;
}): EventParty | null {
  const name = stringValue(input.record.name);
  if (!name) return null;
  const identityUrls = publicIdentityUrls(input.record);
  const linkedIn = socialHandleUrl("linkedin", input.record.linkedin_handle);
  const website = safePublicUrl(input.record.website);
  const url = input.preferWebsite
    ? website ?? linkedIn ?? identityUrls[0]
    : linkedIn ?? website ?? identityUrls[0];
  const entityType = linkedIn?.includes("/company/") || input.preferWebsite
    ? "organization"
    : "person";
  return {
    name,
    ...(url ? { url } : {}),
    ...(identityUrls.length > 0 ? { identityUrls } : {}),
    entityType,
    role: input.role,
    evidence: createLumaPublicEvidence(
      input.canonicalUrl,
      input.observedAt,
      input.role,
      `${name}:${identityUrls.join(",")}`,
    ),
  };
}

function collectEmbeddedEventUrls(
  value: unknown,
  canonicalUrl: string,
  output: Set<string>,
  depth = 0,
): void {
  if (depth > 10 || output.size >= 100) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectEmbeddedEventUrls(entry, canonicalUrl, output, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const apiId = stringValue(record.api_id);
  if (apiId?.startsWith("evt-")) {
    const rawUrl = stringValue(record.url)
      ?? stringValue(record.event_url)
      ?? stringValue(record.slug);
    if (rawUrl) {
      try {
        const absolute = /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : new URL(`/${rawUrl.replace(/^\/+/, "")}`, canonicalUrl).toString();
        const eventUrl = canonicalizeLumaUrl(absolute);
        if (eventUrl && eventUrl !== canonicalUrl) output.add(eventUrl);
      } catch {
        // Ignore malformed embedded event records.
      }
    }
  }
  for (const nested of Object.values(record)) {
    collectEmbeddedEventUrls(nested, canonicalUrl, output, depth + 1);
  }
}

export function createLumaPublicEvidence(
  canonicalUrl: string,
  observedAt: number,
  role: EventSourceEvidence["observedRole"],
  discriminator: string,
  targetUrl?: string,
  eventKey = lumaEventKey(canonicalUrl) ?? canonicalUrl,
): EventSourceEvidence {
  return {
    eventKey,
    sourceUrl: canonicalUrl,
    ...(targetUrl ? { targetUrl } : {}),
    observedAt,
    observedRole: role,
    confidence: "high",
    scope: { kind: "public" },
    provider: "luma",
    extractorVersion: LUMA_EXTRACTOR_VERSION,
    observationId: stableObservationId([canonicalUrl, role, discriminator]),
  };
}

function extractGoingCount(text: string): number | null {
  const match = text.match(/([\d,]+)\s+(?:people\s+)?going/i);
  return match ? Number.parseInt(match[1].replaceAll(",", ""), 10) : null;
}

export function extractLumaEventFromHtml(input: {
  url: string;
  html: string;
  observedAt?: number;
}): EventSource {
  const canonicalUrl = canonicalizeLumaUrl(input.url);
  const key = lumaEventKey(input.url);
  if (!canonicalUrl || !key) throw new Error("unsupported_event_url");
  const observedAt = input.observedAt ?? Math.floor(Date.now() / 1000);
  const $ = cheerio.load(input.html);
  const nextPageData = readLumaNextPageData($);
  let jsonLd: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (jsonLd) return;
    try {
      jsonLd = findEventJsonLd(JSON.parse($(element).text()));
    } catch {
      // Ignore malformed unrelated JSON-LD blocks.
    }
  });
  const eventData = (jsonLd ?? {}) as Record<string, unknown>;
  const hasJsonLd = Object.keys(eventData).length > 0;
  if (!hasJsonLd) throw new Error("event_metadata_missing");

  const title = stringValue(eventData.name)
    ?? stringValue($("h1").first().text())
    ?? stringValue($("title").text().split("·")[0])
    ?? "";
  if (!title) throw new Error("event_title_missing");
  const startsAt = stringValue(eventData.startDate);
  const endsAt = stringValue(eventData.endDate);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const keywords = eventData.keywords;
  const rawTopics = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string"
      ? keywords.split(",")
      : [];
  const topics: string[] = [];
  for (const item of rawTopics) {
    if (typeof item !== "string") continue;
    const topic = item.trim();
    if (topic) topics.push(topic);
    if (topics.length === 20) break;
  }
  let parties: EventParty[] = [];
  const addParties = (value: unknown, role: EventRelationshipRole) => {
    for (const party of personOrOrgName(value)) {
      addUniqueParty(parties, {
        ...party,
        role,
        evidence: createLumaPublicEvidence(
          canonicalUrl,
          observedAt,
          role,
          `${party.name}:${party.url ?? ""}`,
        ),
      });
    }
  };
  addParties(eventData.organizer, "organized_by");
  addParties(eventData.performer, "hosted_by");
  addParties(eventData.contributor, "co_hosted_by");
  addParties(eventData.sponsor, "sponsored_by");
  addParties(eventData.location, "venue_provided_by");

  const calendarRecord = asRecord(nextPageData?.calendar);
  const hostRecords = Array.isArray(nextPageData?.hosts)
    ? nextPageData.hosts
        .map((host) => asRecord(host))
        .filter((host): host is Record<string, unknown> => host !== null)
    : [];
  if (calendarRecord || hostRecords.length > 0) {
    const publicHostNames = new Set(hostRecords.flatMap((host) => {
      const name = stringValue(host.name);
      return name ? [normalizedText(name).toLowerCase()] : [];
    }));
    parties = parties.filter(
      (party) =>
        party.role !== "organized_by"
        || !publicHostNames.has(normalizedText(party.name).toLowerCase()),
    );
    const organizerParty = calendarRecord
      ? partyFromPublicRecord({
          record: calendarRecord,
          role: "organized_by",
          canonicalUrl,
          observedAt,
          preferWebsite: true,
        })
      : null;
    if (organizerParty) addUniqueParty(parties, organizerParty);
    const organizerName = organizerParty
      ? normalizedText(organizerParty.name).toLowerCase()
      : null;
    for (const hostRecord of hostRecords) {
      const hostParty = partyFromPublicRecord({
        record: hostRecord,
        role: "hosted_by",
        canonicalUrl,
        observedAt,
      });
      if (
        hostParty
        && normalizedText(hostParty.name).toLowerCase() !== organizerName
      ) {
        addUniqueParty(parties, hostParty);
      }
    }
  }

  const calendarUrls = new Set<string>();
  const relatedEventUrls = new Set<string>();
  const calendarUrl = embeddedCalendarUrl(nextPageData, canonicalUrl);
  if (calendarUrl && calendarUrl !== canonicalUrl) calendarUrls.add(calendarUrl);
  $(
    'a[data-calendar-url][href], a[data-event-url][href], a[data-testid*="calendar" i][href], [data-testid*="event-card" i] a[href], article[data-event-card] a[href]',
  ).each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, canonicalUrl).toString();
      const related = canonicalizeLumaUrl(absolute);
      if (!related || related === canonicalUrl) return;
      const anchor = $(element);
      const isCalendarLink =
        anchor.is("[data-calendar-url]") ||
        /calendar/i.test(anchor.attr("data-testid") ?? "");
      if (isCalendarLink) calendarUrls.add(related);
      else relatedEventUrls.add(related);
    } catch {
      // Ignore malformed links.
    }
  });

  const timezone = stringValue(eventData.eventAttendanceMode) === "https://schema.org/OnlineEventAttendanceMode"
    ? "online"
    : stringValue(asRecord(eventData.location)?.timezone);
  const count = extractGoingCount(bodyText);
  return {
    version: 1,
    key,
    provider: "luma",
    canonicalUrl,
    title,
    startsAt,
    endsAt,
    timezone,
    location: locationLabel(eventData.location),
    topics,
    audience: { goingCount: count },
    status: eventStatus(eventData.eventStatus, endsAt, observedAt),
    observedAt,
    confidence: hasJsonLd ? "high" : "medium",
    scope: { kind: "public" },
    parties,
    calendarUrls: [...calendarUrls],
    relatedEventUrls: [...relatedEventUrls],
    evidence: [
      createLumaPublicEvidence(canonicalUrl, observedAt, "event", `${title}:${startsAt ?? ""}`),
      ...(count === null
        ? []
        : [createLumaPublicEvidence(canonicalUrl, observedAt, "aggregate", `going:${count}`)]),
      ...[...calendarUrls].map((url) =>
        createLumaPublicEvidence(canonicalUrl, observedAt, "listed_on_calendar", url, url)),
      ...[...relatedEventUrls].map((url) =>
        createLumaPublicEvidence(canonicalUrl, observedAt, "related_event", url, url)),
    ],
    guestBoundary: (() => {
      const explicitRegistrationGate = /register to view guest list/i.test(bodyText);
      const nextEvent = asRecord(nextPageData?.event);
      const guestData = asRecord(nextPageData?.guest_data);
      const featuredGuestCount = Array.isArray(nextPageData?.featured_guests)
        ? nextPageData.featured_guests.length
        : 0;
      const guestCount = typeof nextPageData?.guest_count === "number"
        ? nextPageData.guest_count
        : 0;
      const truncatedAnonymousGuestList =
        nextEvent?.show_guest_list === true
        && !stringValue(guestData?.ticket_key)
        && guestCount > featuredGuestCount;
      return explicitRegistrationGate || truncatedAnonymousGuestList
        ? { state: "gated", reason: "registration_required" }
        : { state: "public", reason: null };
    })(),
  };
}

export type LumaCalendarPage = {
  canonicalUrl: string;
  eventUrls: string[];
  nextPageUrl: string | null;
};

/** Extract only explicitly marked calendar event cards; a hostname match is not proof. */
export function extractLumaCalendarFromHtml(input: {
  url: string;
  html: string;
}): LumaCalendarPage {
  const canonicalUrl = canonicalizeLumaUrl(input.url);
  if (!canonicalUrl) throw new Error("unsupported_event_url");
  const $ = cheerio.load(input.html);
  const nextPageData = readLumaNextPageData($);
  const nextCalendarUrl = embeddedCalendarUrl(nextPageData, canonicalUrl);
  const calendarRoot = $(
    '[data-calendar-page], [data-testid*="calendar" i], [data-event-list], [class*="calendar-page" i]',
  ).first();
  const isEmbeddedCalendarPage = nextCalendarUrl === canonicalUrl;
  if (!calendarRoot.length && !isEmbeddedCalendarPage) {
    throw new Error("calendar_metadata_missing");
  }

  const eventUrls = new Set<string>();
  collectEmbeddedEventUrls(nextPageData, canonicalUrl, eventUrls);
  const eventRoot = calendarRoot.length ? calendarRoot : $("body");
  eventRoot
    .find('[data-event-url], [data-testid*="event-card" i] a[href], article[data-event-card] a[href]')
    .each((_, element) => {
      const raw = $(element).attr("data-event-url") ?? $(element).attr("href");
      if (!raw) return;
      try {
        const candidate = canonicalizeLumaUrl(new URL(raw, canonicalUrl).toString());
        if (candidate && candidate !== canonicalUrl) eventUrls.add(candidate);
      } catch {
        // Ignore malformed card URLs.
      }
    });
  if (eventUrls.size === 0) throw new Error("calendar_metadata_missing");

  const nextLink = eventRoot
    .find('a[rel="next"][href], a[data-calendar-next][href]')
    .filter((_, element) =>
      /^\s*(?:next|more)?\s*$/i.test($(element).text()) || $(element).is("[data-calendar-next]"),
    )
    .first()
    .attr("href");
  let nextPageUrl: string | null = null;
  if (nextLink) {
    try {
      const candidate = canonicalizeLumaUrl(new URL(nextLink, canonicalUrl).toString());
      if (candidate && candidate !== canonicalUrl) nextPageUrl = candidate;
    } catch {
      nextPageUrl = null;
    }
  }
  return { canonicalUrl, eventUrls: [...eventUrls], nextPageUrl };
}
