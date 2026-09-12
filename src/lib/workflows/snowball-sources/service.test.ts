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
          "calendar":{"api_id":"cal-1","name":"AI Builders"},
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
    });
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

  it("protects the server-owned source result from completion callbacks", () => {
    const callback = { source: { resolvedSource: { provider: "luma" } }, message: "done" };
    removeServerOwnedSnowballSourceResult(callback);
    expect(callback).toEqual({ message: "done" });
  });
});
