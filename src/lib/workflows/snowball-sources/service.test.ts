import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { contentItems } from "@/lib/db/schema";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import { readEventTraversalPolicy } from "@/lib/workflows/event-sources/policy";
import {
  prepareNetworkSnowballSource,
  previewSnowballSource,
  removeServerOwnedSnowballSourceResult,
  SNOWBALL_SOURCE_RUNTIME_RESULT_KEY,
} from "@/lib/workflows/snowball-sources/service";

describe("Network Snowball generic source preparation", () => {
  beforeEach(() => resetCoreTables());

  it("resolves, persists, and briefs a bounded generic organization envelope", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const transport = vi.fn(async () => ({
      url: "https://metr.org/about",
      status: 200,
      contentType: "text/html",
      body: `<html><head><title>About METR</title></head><body>
        <h1>About METR</h1><h2>Our team</h2><p>A research organization.</p>
      </body></html>`,
    }));
    const result = await prepareNetworkSnowballSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://metr.org/about?tk=must-not-persist",
      traversal: readEventTraversalPolicy({}),
      participantAccess: { enabled: true, browserSessionName: "personal-browser" },
      transport,
    });
    expect(result).toMatchObject({
      resolvedSource: { provider: "generic", kind: "organization" },
      accessPlan: {
        mode: "public_only",
        signedInRequested: true,
        signedInSupported: false,
      },
      partial: false,
    });
    expect(db.select().from(contentItems).all()).toEqual([
      expect.objectContaining({ title: "About METR", platformTarget: "https://metr.org/about" }),
    ]);
    expect(getWorkflowRun(run.id)?.result).not.toContain("must-not-persist");
  });

  it("returns useful URL classification when public preview fetch fails", async () => {
    const preview = await previewSnowballSource({
      seedUrl: "https://x.com/acme/status/123",
      transport: async () => { throw new Error("blocked"); },
    });
    expect(preview).toMatchObject({
      resolvedSource: { provider: "x", kind: "post" },
      accessPlan: { mode: "public_only" },
      publicSource: null,
    });
  });

  it("refines an ambiguous Luma slug to calendar and disables signed-in participant access", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://luma.com/ai_builders") {
        return new Response(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
          "calendar":{"api_id":"cal-1","name":"AI Builders","slug":"ai_builders"},
          "events":[{"api_id":"evt-1","url":"build-night"}]
        }}}}}</script>`, { status: 200 });
      }
      return new Response(`<script type="application/ld+json">{
        "@type":"Event","name":"Build Night"
      }</script>`, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await prepareNetworkSnowballSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/ai_builders",
      traversal: readEventTraversalPolicy({ maxEvents: 2 }),
      participantAccess: { enabled: true, browserSessionName: "personal-browser" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(result).toMatchObject({
      resolvedSource: { provider: "luma", kind: "calendar" },
      accessPlan: {
        mode: "public_only",
        signedInRequested: true,
        signedInSupported: false,
      },
      lumaContext: {
        resolvedRoot: { kind: "calendar", title: "AI Builders" },
        events: [{ title: "Build Night" }],
      },
    });
  });

  it("uses the explicit resolved event root for same-provider Luma aliases", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://luma.com/alias") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://lu.ma/ResolvedCase" },
        });
      }
      return new Response('<script type="application/ld+json">{"@type":"Event","name":"Resolved Event"}</script>', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await prepareNetworkSnowballSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://luma.com/alias",
      traversal: readEventTraversalPolicy({}),
      participantAccess: { enabled: false, browserSessionName: "" },
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(result).toMatchObject({
      resolvedSource: {
        provider: "luma",
        kind: "event",
        canonicalUrl: "https://lu.ma/ResolvedCase",
        capabilities: { signedInRead: true },
      },
      lumaContext: {
        resolvedRoot: { canonicalUrl: "https://lu.ma/ResolvedCase", kind: "event" },
      },
    });
  });

  it("routes generic-to-Luma redirects through the Luma adapter without upgrading consent", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const transport = vi.fn(async (_url, limits) => {
      await limits?.beforeRequest?.("https://redirect.example/luma");
      return {
        url: "https://luma.com/resolved-event",
        status: 200,
        contentType: "text/html",
        body: "redirect body is not used as generic evidence",
      };
    });
    const fetchImpl = vi.fn(async () => new Response(
      '<script type="application/ld+json">{"@type":"Event","name":"Resolved Event"}</script>',
      { status: 200 },
    )) as unknown as typeof fetch;
    const result = await prepareNetworkSnowballSource({
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://redirect.example/luma",
      traversal: readEventTraversalPolicy({ maxProviderRequests: 3 }),
      participantAccess: { enabled: true, browserSessionName: "personal-browser" },
      transport,
      fetchImpl,
      sleepImpl: async () => undefined,
    });
    expect(result).toMatchObject({
      resolvedSource: { provider: "luma", kind: "event" },
      accessPlan: {
        mode: "public_only",
        signedInRequested: true,
        signedInSupported: true,
        reason: expect.stringContaining("Renew consent"),
      },
      lumaContext: { events: [{ title: "Resolved Event" }] },
    });
    expect(result).not.toHaveProperty("eventReportCapability");
  });

  it("persists generic redirect charges across resume attempts", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const transport = vi.fn(async (_url, limits) => {
      if (await limits?.beforeRequest?.("https://example.com/start") === false) throw new Error("budget");
      if (await limits?.beforeRequest?.("https://example.com/redirect") === false) throw new Error("budget");
      throw new Error("unavailable");
    });
    const input = {
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://example.com/start",
      traversal: readEventTraversalPolicy({ maxProviderRequests: 3 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      transport,
    };
    await prepareNetworkSnowballSource(input);
    await prepareNetworkSnowballSource(input);
    const stored = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
    expect(stored[SNOWBALL_SOURCE_RUNTIME_RESULT_KEY]).toMatchObject({ requestsUsed: 3 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("shares one durable cap across a generic redirect and Luma adapter resumes", async () => {
    const run = createWorkflowRun({ workflowType: "search", status: "running", trigger: "template" });
    const transport = vi.fn(async (_url, limits) => {
      if (await limits?.beforeRequest?.("https://redirect.example/start") === false) {
        throw new Error("budget");
      }
      return {
        url: "https://luma.com/resolved-event",
        status: 200,
        contentType: "text/html",
        body: "redirect body",
      };
    });
    const fetchImpl = vi.fn(async () => new Response(
      '<script type="application/ld+json">{"@type":"Event","name":"Resolved Event"}</script>',
      { status: 200 },
    )) as unknown as typeof fetch;
    const input = {
      runId: run.id,
      ownerWorkspace: "signals",
      seedUrl: "https://redirect.example/start",
      traversal: readEventTraversalPolicy({ maxProviderRequests: 2 }),
      participantAccess: { enabled: false, browserSessionName: "" },
      transport,
      fetchImpl,
      sleepImpl: async () => undefined,
    };

    await prepareNetworkSnowballSource(input);
    await prepareNetworkSnowballSource(input);

    const stored = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
    expect(stored[SNOWBALL_SOURCE_RUNTIME_RESULT_KEY]).toMatchObject({ requestsUsed: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("propagates cancelled preview signals to the server transport", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const pending = previewSnowballSource({
      seedUrl: "https://example.com/about",
      signal: controller.signal,
      transport: async (_url, limits) => {
        observedSignal = limits?.signal;
        return new Promise((_resolve, reject) => {
          limits?.signal?.addEventListener("abort", () => reject(new Error("cancelled")));
        });
      },
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(observedSignal).toBe(controller.signal);
  });

  it("refines ambiguous Luma calendar metadata during preview", async () => {
    const preview = await previewSnowballSource({
      seedUrl: "https://luma.com/ai_builders",
      signedInRequested: true,
      transport: async () => ({
        url: "https://luma.com/ai_builders",
        status: 200,
        contentType: "text/html",
        body: `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialData":{"data":{
          "calendar":{"api_id":"cal-1","name":"AI Builders"},"events":[]
        }}}}}</script>`,
      }),
    });
    expect(preview).toMatchObject({
      resolvedSource: { provider: "luma", kind: "calendar" },
      accessPlan: { mode: "public_only", signedInSupported: false },
    });
  });

  it("previews a captured Luma event as an event when it embeds its owning calendar", async () => {
    const capturedHtml = readFileSync(
      new URL("../event-sources/fixtures/luma-event-with-calendar.html", import.meta.url),
      "utf8",
    );
    const preview = await previewSnowballSource({
      seedUrl: "https://luma.com/pqr8u92i",
      signedInRequested: true,
      transport: async () => ({
        url: "https://luma.com/pqr8u92i",
        status: 200,
        contentType: "text/html",
        body: capturedHtml,
      }),
    });

    expect(preview).toMatchObject({
      resolvedSource: { provider: "luma", kind: "event" },
      accessPlan: { mode: "public_and_signed_in", signedInSupported: true },
      publicSource: { title: "Build Fridays SF" },
    });
  });

  it("does not offer signed-in access when a Luma preview cannot be classified", async () => {
    const preview = await previewSnowballSource({
      seedUrl: "https://luma.com/large-calendar",
      signedInRequested: true,
      transport: async () => { throw new Error("source_response_too_large"); },
    });

    expect(preview).toMatchObject({
      resolvedSource: { provider: "luma", kind: "unknown" },
      accessPlan: { mode: "public_only", signedInSupported: false },
    });
  });

  it("protects the server-owned source result from completion callbacks", () => {
    const callback = {
      source: { resolvedSource: { provider: "luma" } },
      sourceRuntime: { requestsUsed: 40 },
      message: "done",
    };
    removeServerOwnedSnowballSourceResult(callback);
    expect(callback).toEqual({ message: "done" });
  });
});
