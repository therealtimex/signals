import { describe, expect, it } from "vitest";
import {
  extractLumaCalendarFromHtml,
  extractLumaEventFromHtml,
} from "@/lib/workflows/event-sources/providers/luma";

const HTML = `<!doctype html><html><head>
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Event","name":"Build Friday",
  "startDate":"2026-09-18T17:00:00-07:00","endDate":"2026-09-18T20:00:00-07:00",
  "location":{"@type":"Place","name":"Sentry HQ"},
  "organizer":[{"@type":"Organization","name":"AI Beavers","url":"https://example.com/beavers?token=must-not-persist&ref=event"}],
  "performer":{"@type":"Person","name":"Brandon Host"},
  "sponsor":{"@type":"Organization","name":"Sentry"},
  "keywords":["AI","builders"]
}</script></head><body><h1>Build Friday</h1><p>250 Going</p>
<p>Register to View Guest List</p><p>Hendrik teaser guest</p>
<a href="/next-event?tk=adjacent-secret">Next</a>
<a data-calendar-url href="/ai-calendar?tk=calendar-secret">View Calendar</a></body></html>`;

describe("Luma public extraction", () => {
  it("retains explicit roles and aggregates without turning teaser guests into people", () => {
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/pqr8u92i?tk=secret",
      html: HTML,
      observedAt: 1_789_171_200,
    });
    expect(event.canonicalUrl).toBe("https://luma.com/pqr8u92i");
    expect(event.title).toBe("Build Friday");
    expect(event.location).toBe("Sentry HQ");
    expect(event.audience.goingCount).toBe(250);
    expect(event.parties.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "AI Beavers", role: "organized_by" },
      { name: "Brandon Host", role: "hosted_by" },
      { name: "Sentry", role: "sponsored_by" },
      { name: "Sentry HQ", role: "venue_provided_by" },
    ]);
    expect(event.parties[0]?.url).toBe("https://example.com/beavers?ref=event");
    expect(event.parties.some((party) => party.name.includes("Hendrik"))).toBe(false);
    expect(event.relatedEventUrls).toContain("https://luma.com/next-event");
    expect(event.relatedEventUrls).not.toContain("https://luma.com/ai-calendar");
    expect(event.calendarUrls).toEqual(["https://luma.com/ai-calendar"]);
    expect(event.evidence).toContainEqual(expect.objectContaining({
      observedRole: "listed_on_calendar",
      targetUrl: "https://luma.com/ai-calendar",
    }));
    expect(event.guestBoundary).toEqual({ state: "gated", reason: "registration_required" });
  });

  it("does not classify an arbitrary Luma profile or calendar page as an event", () => {
    expect(() => extractLumaEventFromHtml({
      url: "https://luma.com/user/alice",
      html: "<html><body><h1>Alice Builder</h1></body></html>",
    })).toThrow("event_metadata_missing");
  });

  it("extracts typed calendar cards and rejects an unmarked profile page", () => {
    expect(extractLumaCalendarFromHtml({
      url: "https://luma.com/ai-calendar?tk=secret",
      html: `<section data-calendar-page>
        <article><a href="/event-a?tk=one">A</a></article>
        <a data-event-url="/event-b#guests">B</a>
        <a data-calendar-next href="/ai-calendar/page-2?token=two">Next</a>
      </section>`,
    })).toEqual({
      canonicalUrl: "https://luma.com/ai-calendar",
      eventUrls: ["https://luma.com/event-a", "https://luma.com/event-b"],
      nextPageUrl: "https://luma.com/ai-calendar/page-2",
    });
    expect(() => extractLumaCalendarFromHtml({
      url: "https://luma.com/user/alice",
      html: '<main><a href="/event-a">Alice\'s event</a></main>',
    })).toThrow("calendar_metadata_missing");
  });

  it("preserves cancelled status and leaves an absent timezone unknown", () => {
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/cancelled",
      html: `<script type="application/ld+json">{
        "@context":"https://schema.org","@type":"Event","name":"Cancelled Demo",
        "eventStatus":"https://schema.org/EventCancelled"
      }</script>`,
    });
    expect(event.status).toBe("cancelled");
    expect(event.timezone).toBeNull();
  });
});
