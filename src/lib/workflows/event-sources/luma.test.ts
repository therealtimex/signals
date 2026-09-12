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
<a data-event-url href="/next-event?tk=adjacent-secret">Next</a>
<a data-calendar-url href="/ai-calendar?tk=calendar-secret">View Calendar</a></body></html>`;

// Curated from QA's 2026-09-12 capture of https://luma.com/pqr8u92i. It retains the
// provider-owned public fields that falsified the original JSON-LD-only assumptions.
const CAPTURED_PUBLIC_PAGE_EXCERPT = `<!doctype html><html><head>
<script type="application/ld+json">{
  "@context":"https://schema.org","@type":"Event","name":"Build Fridays SF",
  "startDate":"2026-09-11T17:00:00-07:00",
  "organizer":[
    {"@type":"Organization","name":"AI BEAVERS","url":"https://luma.com/ai_beavers"},
    {"@type":"Person","name":"AI BEAVERS","url":"https://luma.com/user/ai_beavers"},
    {"@type":"Person","name":"Brandon Corona - Bhardwaj","url":"https://luma.com/user/usr-Ps1TrCC9K0VVXC7"},
    {"@type":"Person","name":"Sentry","url":"https://luma.com/user/getsentry"},
    {"@type":"Person","name":"BridgeUs","url":"https://luma.com/user/bridgeus"}
  ]
}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
  "calendar":{"api_id":"cal-W7N51nFcd0IF4Up","name":"AI BEAVERS","slug":"ai_beavers","website":"https://ai-beavers.com","linkedin_handle":"/company/109838496","twitter_handle":"AI_BEAVERS","instagram_handle":"ai.beavers","youtube_handle":"ai-beavers"},
  "event":{"api_id":"evt-RpyPZB9GoZOdXiU","calendar_api_id":"cal-W7N51nFcd0IF4Up","show_guest_list":true},
  "guest_data":{"ticket_key":null},"guest_count":279,"featured_guests":[{"api_id":"usr-teaser"}],
  "hosts":[
    {"api_id":"usr-7p52FuQTaVIUJS2","name":"AI BEAVERS","username":"ai_beavers","linkedin_handle":"/company/109838496","twitter_handle":"AI_BEAVERS","website":"https://ai-beavers.com"},
    {"api_id":"usr-Ps1TrCC9K0VVXC7","name":"Brandon Corona - Bhardwaj","linkedin_handle":"/in/brandon-corona-bhardwaj","twitter_handle":"__brandoncorona","website":"https://brandoncoronabhardwaj.com"},
    {"api_id":"usr-IVQaHdc6Lwy9XS5","name":"Sentry","username":"getsentry","linkedin_handle":"/company/sentry","twitter_handle":"sentry","website":"https://sentry.io/welcome/"},
    {"api_id":"usr-u6VEoDdyD2Ux5uH","name":"BridgeUs","username":"bridgeus","linkedin_handle":"/company/bridgeusco","website":"https://bridgeus.co"}
  ]
}}}}}</script></head><body>
<a href="/discover">Discover</a><a href="/user/ai_beavers">AI BEAVERS profile</a>
<a href="/pricing">Pricing</a><a href="/app">App</a>
</body></html>`;

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

  it("uses captured public page data for the organizer calendar, typed hosts, and access boundary", () => {
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/pqr8u92i?tk=secret",
      html: CAPTURED_PUBLIC_PAGE_EXCERPT,
      observedAt: 1_789_171_200,
    });

    expect(event.calendarUrls).toEqual(["https://luma.com/ai_beavers"]);
    expect(event.relatedEventUrls).toEqual([]);
    expect(event.guestBoundary).toEqual({ state: "gated", reason: "registration_required" });
    expect(event.parties.filter((party) => party.name === "AI BEAVERS")).toHaveLength(1);
    expect(event.parties).toContainEqual(expect.objectContaining({
      name: "AI BEAVERS",
      role: "organized_by",
      entityType: "organization",
      url: "https://ai-beavers.com/",
      identityUrls: expect.arrayContaining([
        "https://www.linkedin.com/company/109838496",
        "https://x.com/AI_BEAVERS",
      ]),
    }));
    expect(event.parties).toContainEqual(expect.objectContaining({
      name: "Brandon Corona - Bhardwaj",
      role: "hosted_by",
      entityType: "person",
      identityUrls: expect.arrayContaining([
        "https://www.linkedin.com/in/brandon-corona-bhardwaj",
      ]),
    }));
    expect(event.parties).toContainEqual(expect.objectContaining({
      name: "Sentry",
      role: "hosted_by",
      entityType: "organization",
      url: "https://sentry.io/welcome/",
    }));
    expect(event.parties).toContainEqual(expect.objectContaining({
      name: "BridgeUs",
      role: "hosted_by",
      entityType: "organization",
      url: "https://bridgeus.co/",
    }));
  });

  it("preserves ambiguous same-name parties unless stable provider identities overlap", () => {
    const event = extractLumaEventFromHtml({
      url: "https://luma.com/same-name-hosts",
      html: `<script type="application/ld+json">{
        "@context":"https://schema.org","@type":"Event","name":"Identity Test",
        "organizer":[
          {"@type":"Person","name":"Alex Kim","url":"https://luma.com/user/alex-one"},
          {"@type":"Person","name":"Alex Kim","url":"https://luma.com/user/alex-two"}
        ]
      }</script><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
        "hosts":[
          {"api_id":"usr-alex-one","name":"Sam Lee","username":"sam-one","linkedin_handle":"/in/sam-one"},
          {"api_id":"usr-alex-two","name":"Sam Lee","username":"sam-two","linkedin_handle":"/in/sam-two"}
        ]
      }}}}}</script>`,
    });

    expect(event.parties.filter((party) => party.name === "Alex Kim")).toEqual([
      expect.objectContaining({ url: "https://luma.com/user/alex-one" }),
      expect.objectContaining({ url: "https://luma.com/user/alex-two" }),
    ]);
    expect(event.parties.filter((party) => party.name === "Sam Lee")).toEqual([
      expect.objectContaining({ providerId: "usr-alex-one", url: "https://www.linkedin.com/in/sam-one" }),
      expect.objectContaining({ providerId: "usr-alex-two", url: "https://www.linkedin.com/in/sam-two" }),
    ]);
  });

  it("extracts typed calendar cards and rejects an unmarked profile page", () => {
    expect(extractLumaCalendarFromHtml({
      url: "https://luma.com/ai-calendar?tk=secret",
      html: `<section data-calendar-page>
        <article data-event-card><a href="/event-a?tk=one">A</a></article>
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

  it("extracts calendar events from provider-owned embedded page data", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
      "calendar":{"api_id":"cal-1","name":"AI BEAVERS","slug":"ai_beavers"},
      "events":[
        {"api_id":"evt-hamburg","url":"build-fridays-hamburg"},
        {"api_id":"evt-berlin","url":"build-fridays-berlin?tk=secret"}
      ]
    }}}}}</script>`;
    expect(extractLumaCalendarFromHtml({
      url: "https://luma.com/ai_beavers?tk=calendar-secret",
      html,
    })).toEqual({
      canonicalUrl: "https://luma.com/ai_beavers",
      eventUrls: [
        "https://luma.com/build-fridays-hamburg",
        "https://luma.com/build-fridays-berlin",
      ],
      nextPageUrl: null,
    });
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
