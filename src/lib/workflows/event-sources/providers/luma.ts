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

export const LUMA_EXTRACTOR_VERSION = 1;

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
  const parties: EventParty[] = [];
  const addParties = (value: unknown, role: EventRelationshipRole) => {
    for (const party of personOrOrgName(value)) {
      parties.push({
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

  const calendarUrls = new Set<string>();
  const relatedEventUrls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, canonicalUrl).toString();
      const related = canonicalizeLumaUrl(absolute);
      if (!related || related === canonicalUrl) return;
      const anchor = $(element);
      const isCalendarLink =
        anchor.is("[data-calendar-url]") ||
        /calendar/i.test(anchor.attr("data-testid") ?? "") ||
        /^\s*(?:view\s+)?calendar\s*$/i.test(normalizedText(anchor.text()));
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
    guestBoundary: {
      state: /register to view guest list/i.test(bodyText) ? "gated" : "public",
      reason: /register to view guest list/i.test(bodyText) ? "registration_required" : null,
    },
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
  const calendarRoot = $(
    '[data-calendar-page], [data-testid*="calendar" i], [data-event-list], [class*="calendar-page" i]',
  ).first();
  if (!calendarRoot.length) throw new Error("calendar_metadata_missing");

  const eventUrls = new Set<string>();
  calendarRoot
    .find('[data-event-url], [data-testid*="event-card" i] a[href], article a[href]')
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

  const nextLink = calendarRoot
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
