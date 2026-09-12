import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { contentItems, graphEdges } from "@/lib/db/schema";
import { createOrg } from "@/lib/db/queries/orgs";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import { readEventTraversalPolicy } from "@/lib/workflows/event-sources/policy";
import {
  EVENT_SOURCE_RESULT_KEY,
  EVENT_SOURCE_RUNTIME_RESULT_KEY,
  ingestNetworkSnowballEventSource,
  removeServerOwnedEventResult,
} from "@/lib/workflows/event-sources/service";

function eventHtml(title = "Build Friday", links: string[] = []) {
  return `<!doctype html><html><head><script type="application/ld+json">{
    "@context":"https://schema.org","@type":"Event","name":"${title}",
    "organizer":{"@type":"Organization","name":"Acme","url":"https://acme.test"}
  }</script></head><body><p>42 Going</p><p>Register to View Guest List</p>
  ${links.map((link) => `<a href="${link}">Related</a>`).join("")}</body></html>`;
}

describe("Network Snowball event source ingestion", () => {
  beforeEach(() => resetCoreTables());

  it("persists a deterministic public Content item and no protected people", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://luma.com/demo");
      return new Response(eventHtml(), { status: 200 });
    }) as unknown as typeof fetch;
    const input = {
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/demo?tk=must-not-persist&utm_source=test",
      traversal: readEventTraversalPolicy({ maxEvents: 1 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      writeGraphEdges: false,
      fetchImpl,
      sleepImpl: async () => undefined,
    };
    await ingestNetworkSnowballEventSource(input);
    await ingestNetworkSnowballEventSource(input);

    const content = db.select().from(contentItems).all();
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ contentType: "article", origin: "imported", status: "imported", aiGenerated: false });
    expect(content[0].platformData).not.toContain("must-not-persist");
    expect(getWorkflowRun(run.id)?.result).not.toContain("must-not-persist");
    expect(JSON.parse(getWorkflowRun(run.id)!.result!)[EVENT_SOURCE_RESULT_KEY]).toMatchObject({
      canonicalSeedUrl: "https://luma.com/demo",
      guestBoundary: { state: "not_requested", reason: "public_only" },
    });
    expect(JSON.parse(getWorkflowRun(run.id)!.result!)[EVENT_SOURCE_RUNTIME_RESULT_KEY]).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("writes explicit public role edges only when automatic graph linking is allowed", async () => {
    createOrg({ name: "Acme", domain: "acme.test" });
    const fetchImpl = vi.fn(async () => new Response(eventHtml(), { status: 200 })) as unknown as typeof fetch;
    for (const writeGraphEdges of [false, true]) {
      const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
      await ingestNetworkSnowballEventSource({
        runId: run.id,
        ownerWorkspace: "signals",
        seedUrl: "https://luma.com/demo",
        traversal: readEventTraversalPolicy({ maxEvents: 1 }),
        participantAccess: { enabled: false, browserSessionName: "" },
        writeGraphEdges,
        fetchImpl,
        sleepImpl: async () => undefined,
      });
      expect(db.select().from(graphEdges).all()).toHaveLength(writeGraphEdges ? 1 : 0);
    }
  });

  it("follows only sanitized same-provider redirects and records the resolved canonical key", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requested.push(String(url));
      if (requested.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://lu.ma/ResolvedCase?tk=redirect-secret#guests" },
        });
      }
      return new Response(eventHtml("Resolved Event"), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await ingestNetworkSnowballEventSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/alias?tk=seed-secret",
      traversal: readEventTraversalPolicy({ maxEvents: 1, maxProviderRequests: 4 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    expect(requested).toEqual(["https://luma.com/alias", "https://lu.ma/ResolvedCase"]);
    expect(result?.publicResult.rootEventKey).toBe("https://lu.ma/ResolvedCase");
    expect(JSON.stringify(result)).not.toContain("redirect-secret");
  });

  it("rejects redirects outside the Luma allowlist without requesting their destination", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private?token=secret" },
    })) as unknown as typeof fetch;
    const result = await ingestNetworkSnowballEventSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/demo",
      traversal: readEventTraversalPolicy({ maxEvents: 2, maxProviderRequests: 4 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result?.publicResult).toMatchObject({
      partial: true,
      errors: ["unsafe_redirect"],
      traversal: { requestsUsed: 1 },
    });
    expect(getWorkflowRun(run.id)?.result).not.toContain("127.0.0.1");
  });

  it("rejects an oversized HTML response before parsing or persistence", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async () => new Response("not-read", {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    })) as unknown as typeof fetch;

    const result = await ingestNetworkSnowballEventSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/oversized",
      traversal: readEventTraversalPolicy({ maxEvents: 1 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    expect(result?.publicResult).toMatchObject({
      events: [],
      partial: true,
      errors: ["parse_failed"],
    });
    expect(db.select().from(contentItems).all()).toHaveLength(0);
  });

  it("uses stable breadth-first ordering and bounds cycles, depth, and provider requests", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const requested: string[] = [];
    const pages = new Map([
      ["https://luma.com/root", eventHtml("Root", ["/a", "/b", "/a?tk=duplicate"])],
      ["https://luma.com/a", eventHtml("A", ["/root", "/too-deep"])],
      ["https://luma.com/b", eventHtml("B")],
    ]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const canonical = String(url);
      requested.push(canonical);
      return new Response(pages.get(canonical) ?? eventHtml("Unexpected"), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await ingestNetworkSnowballEventSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/root",
      traversal: readEventTraversalPolicy({
        adjacentEventDepth: 1,
        eventsPerCalendar: 5,
        maxEvents: 3,
        maxProviderRequests: 3,
      }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    expect(requested).toEqual([
      "https://luma.com/root",
      "https://luma.com/a",
      "https://luma.com/b",
    ]);
    expect(result?.publicResult.events.map((event) => event.title)).toEqual(["Root", "A", "B"]);
    expect(requested).not.toContain("https://luma.com/too-deep");
    expect(result?.publicResult.traversal).toMatchObject({ requestsUsed: 3, visitedUrls: 3 });
  });

  it("bounds typed calendar pages and retains listing evidence on imported events", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const requested: string[] = [];
    const root = eventHtml("Root").replace(
      "</body>",
      '<a data-calendar-url href="/calendar?tk=secret">View Calendar</a></body>',
    );
    const calendar = `<section data-calendar-page>
      <article><a href="/a">A</a></article>
      <article><a href="/b">B</a></article>
      <article><a href="/c">C</a></article>
      <a data-calendar-next href="/calendar/page-2">Next</a>
    </section>`;
    const pages = new Map([
      ["https://luma.com/root", root],
      ["https://luma.com/calendar", calendar],
      ["https://luma.com/a", eventHtml("A")],
      ["https://luma.com/b", eventHtml("B")],
    ]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const canonical = String(url);
      requested.push(canonical);
      return new Response(pages.get(canonical) ?? "missing", {
        status: pages.has(canonical) ? 200 : 404,
      });
    }) as unknown as typeof fetch;

    const result = await ingestNetworkSnowballEventSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/root",
      traversal: readEventTraversalPolicy({
        adjacentEventDepth: 1,
        eventsPerCalendar: 2,
        maxCalendarPages: 1,
        maxEvents: 4,
        maxProviderRequests: 8,
      }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });

    expect(requested).toEqual([
      "https://luma.com/root",
      "https://luma.com/calendar",
      "https://luma.com/a",
      "https://luma.com/b",
    ]);
    expect(result?.publicResult.events.map((event) => event.title)).toEqual(["Root", "A", "B"]);
    expect(result?.publicResult.events[1]?.evidence).toContainEqual(expect.objectContaining({
      eventKey: "https://luma.com/a",
      sourceUrl: "https://luma.com/calendar",
      targetUrl: "https://luma.com/a",
      observedRole: "listed_on_calendar",
    }));
    expect(result?.publicResult.traversal).toMatchObject({
      visitedUrls: 4,
      truncated: true,
      stopReason: "calendar_limit",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not reset the provider request budget when an existing run is retried", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    const input = {
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/retry-budget",
      traversal: readEventTraversalPolicy({ maxEvents: 2, maxProviderRequests: 1 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    };

    const first = await ingestNetworkSnowballEventSource(input);
    const second = await ingestNetworkSnowballEventSource(input);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first?.publicResult.traversal.requestsUsed).toBe(1);
    expect(second?.publicResult.traversal).toMatchObject({
      requestsUsed: 1,
      truncated: true,
      stopReason: "request_budget",
    });
  });

  it("prevents an agent callback from replacing the server-owned event result", () => {
    const callback = {
      [EVENT_SOURCE_RESULT_KEY]: { events: ["fabricated"] },
      [EVENT_SOURCE_RUNTIME_RESULT_KEY]: { requestsUsed: 0 },
      safe: true,
    };
    removeServerOwnedEventResult(callback);
    expect(callback).toEqual({ safe: true });
  });
});
