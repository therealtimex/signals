import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listConnections } from "@/app/api/browser-connections/route";
import { GET, POST } from "@/app/api/browser-connections/[id]/allowed-origins/route";
import { DELETE } from "@/app/api/browser-connections/[id]/allowed-origins/[origin]/route";
import { POST as APPLY } from "@/app/api/browser-connections/[id]/allowed-origins/apply/route";
import { POST as SETUP_LINKEDIN } from "@/app/api/platforms/linkedin/browser-session/route";
import {
  addConnectionOrigin,
  listConnectionOrigins,
} from "@/lib/db/queries/browser-connection-origins";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { resetCoreTables } from "@/test/db";
import { fakeRtxBrowserSessions, type FakeRtxOptions } from "@/test/fake-rtx-browser-sessions";
import { NextRequest } from "next/server";

const DEFAULTS = [
  "https://x.com",
  "https://www.linkedin.com",
  "https://lnkd.in",
  "https://www.facebook.com",
];

function embedded(options: FakeRtxOptions = {}) {
  vi.stubEnv("RTX_APP_ID", "app-test");
  vi.stubEnv("RTX_API_BASE_URL", "http://127.0.0.1:3101");
  vi.stubEnv("SIGNALS_INSTANCE", "");
  const rtx = fakeRtxBrowserSessions(options);
  vi.stubGlobal("fetch", rtx.fetchImpl);
  return rtx;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const originCtx = (id: string, origin: string) => ({
  params: Promise.resolve({ id, origin: encodeURIComponent(origin) }),
});

function post(id: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/browser-connections/${id}/allowed-origins`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
}

function remove(id: string, origin: string) {
  return DELETE(
    new Request(`http://localhost/api/browser-connections/${id}/allowed-origins/x`, { method: "DELETE" }),
    originCtx(id, origin),
  );
}

describe("/api/browser-connections/[id]/allowed-origins", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adds a pasted link's origin: saved before RealTimeX is told, then read back as active", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    let savedWhenApplied: string[] = [];
    const rtx = embedded({
      onCreate: () => {
        savedWhenApplied = listConnectionOrigins(publish.id).map((row) => row.origin);
      },
    });

    const response = await post(publish.id, { url: "https://lnkd.in.example/p/abc?x=1#frag" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      origin: "https://lnkd.in.example",
      status: "added",
      persisted: true,
      applied: true,
      effective: [...DEFAULTS, "https://lnkd.in.example"],
      runtime: {
        reachable: true,
        allowedOrigins: [...DEFAULTS, "https://lnkd.in.example"],
        applied: true,
      },
    });
    expect(savedWhenApplied).toEqual(["https://lnkd.in.example"]);
    // Only a guardrail re-declare and a read-back: no start, stop or delete, so sign-ins survive.
    expect(rtx.calls.map((call) => call.path)).toEqual([
      "/cli/create-browser-session",
      "/cli/list-browser-sessions",
    ]);
    expect(rtx.calls[0].body).not.toHaveProperty("url");
    expect(listConnectionOrigins(publish.id)[0]).toMatchObject({ source: "settings" });
  });

  it("records where a website was allowed from", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    embedded();

    await post(publish.id, { url: "https://www.eventbrite.com/e/1", source: "recovery" });

    expect(listConnectionOrigins(publish.id)[0]).toMatchObject({
      origin: "https://www.eventbrite.com",
      source: "recovery",
    });
  });

  it.each([
    ["not a link", "invalid_url"],
    ["*.example.com", "invalid_url"],
    ["ftp://files.example.com", "unsupported_scheme"],
    ["https://user:pass@example.com", "credentials_not_allowed"],
    [undefined, "invalid_url"],
  ])("rejects %j with %s and saves nothing", async (url, code) => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    const rtx = embedded();

    const response = await post(publish.id, { url });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(listConnectionOrigins(publish.id)).toEqual([]);
    expect(rtx.calls).toEqual([]);
  });

  it("reports a Signals default or an existing website without writing anything", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: publish.id, origin: "https://example.org", source: "settings" });
    const rtx = embedded();

    const asDefault = await post(publish.id, { url: "https://X.com:443/home" });
    const asAdded = await post(publish.id, { url: "https://example.org/about" });

    expect(asDefault.status).toBe(200);
    expect(await asDefault.json()).toMatchObject({ origin: "https://x.com", status: "already_default" });
    expect(asAdded.status).toBe(200);
    expect(await asAdded.json()).toMatchObject({ origin: "https://example.org", status: "already_added" });
    expect(rtx.calls.filter((call) => call.path === "/cli/create-browser-session")).toEqual([]);
    expect(listConnectionOrigins(publish.id)).toHaveLength(1);
  });

  it("keeps the website and answers 502 when RealTimeX refuses the update", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    embedded({ createFails: "The RealTimeX Browser registry is busy." });

    const response = await post(publish.id, { url: "https://example.org" });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      origin: "https://example.org",
      status: "added",
      persisted: true,
      applied: false,
      error: "The RealTimeX Browser registry is busy.",
      runtime: { reachable: true, applied: false },
    });
    expect(listConnectionOrigins(publish.id).map((row) => row.origin)).toEqual(["https://example.org"]);
  });

  it("answers 502 when RealTimeX accepts the call but reads back a different list", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    embedded({ createIgnored: true });

    const response = await post(publish.id, { url: "https://example.org" });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ applied: false, runtime: { applied: false } });
  });

  it("answers 502 with reachable:false when RealTimeX can't be reached", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    embedded({ createFails: "fetch failed", listFails: true });

    const response = await post(publish.id, { url: "https://example.org" });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      applied: false,
      runtime: { reachable: false, allowedOrigins: null, applied: null },
    });
  });

  it("refuses signals-publish on a Dev instance before saving anything", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    const rtx = embedded();
    vi.stubEnv("SIGNALS_INSTANCE", "dev");

    const added = await post(publish.id, { url: "https://example.org" });
    const removed = await remove(publish.id, "https://example.org");
    const applied = await APPLY(new Request("http://localhost/x", { method: "POST" }), ctx(publish.id));

    for (const response of [added, removed, applied]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "DEV_INSTANCE_GUARD",
        effect: "browser-session.publish",
      });
    }
    expect(listConnectionOrigins(publish.id)).toEqual([]);
    expect(rtx.calls).toEqual([]);
  });

  it("still lets a Dev instance manage a dedicated connection", async () => {
    const dedicated = ensureBrowserConnection({ sessionName: "brand-x", kind: "dedicated" });
    const rtx = embedded();
    vi.stubEnv("SIGNALS_INSTANCE", "dev");

    const response = await post(dedicated.id, { url: "https://brand.example" });

    expect(response.status).toBe(200);
    expect(rtx.guardrailsOf("brand-x")?.allowedOrigins).toEqual([...DEFAULTS, "https://brand.example"]);
    expect(rtx.guardrailsOf("signals-publish")?.allowedOrigins).toEqual([
      "https://x.com",
      "https://www.linkedin.com",
      "https://www.facebook.com",
    ]);
  });

  it("removes a website and applies the shorter list", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: publish.id, origin: "https://example.org", source: "settings" });
    const rtx = embedded();

    const response = await remove(publish.id, "https://example.org");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      origin: "https://example.org",
      removed: true,
      applied: true,
      effective: DEFAULTS,
    });
    expect(rtx.guardrailsOf("signals-publish")?.allowedOrigins).toEqual(DEFAULTS);
    expect(listConnectionOrigins(publish.id)).toEqual([]);
  });

  it("answers 502 after a removal RealTimeX didn't take, and the row stays deleted", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: publish.id, origin: "https://example.org", source: "settings" });
    embedded({ createFails: "The RealTimeX Browser registry is busy." });

    const response = await remove(publish.id, "https://example.org");

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ removed: true, applied: false });
    expect(listConnectionOrigins(publish.id)).toEqual([]);
  });

  it("won't remove a Signals default", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    const rtx = embedded();

    const response = await remove(publish.id, "https://lnkd.in");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "default_origin" });
    expect(rtx.calls).toEqual([]);
  });

  it("re-applies the saved list on Try again", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: publish.id, origin: "https://example.org", source: "settings" });
    const rtx = embedded();

    const response = await APPLY(new Request("http://localhost/x", { method: "POST" }), ctx(publish.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: true, effective: [...DEFAULTS, "https://example.org"] });
    expect(rtx.guardrailsOf("signals-publish")?.allowedOrigins).toContain("https://example.org");
  });

  it("serves the Settings view, and null runtime when Signals runs standalone", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: publish.id, origin: "https://example.org", source: "recovery" });
    embedded();

    const live = await (await GET(new Request("http://localhost/x"), ctx(publish.id))).json();
    expect(live).toMatchObject({
      sessionName: "signals-publish",
      defaults: DEFAULTS,
      custom: [{ origin: "https://example.org", source: "recovery" }],
      runtime: { reachable: true, applied: false },
    });

    vi.stubEnv("RTX_APP_ID", "");
    const standalone = await (await GET(new Request("http://localhost/x"), ctx(publish.id))).json();
    expect(standalone.runtime).toBeNull();
  });

  it("answers 404 for an unknown connection", async () => {
    embedded();
    const response = await post("bc_missing", { url: "https://example.org" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
  });

  it("lists active connections for the selector", async () => {
    ensureBrowserConnection({ sessionName: "signals-publish" });
    ensureBrowserConnection({ sessionName: "brand-x", kind: "dedicated" });

    const body = await (await listConnections()).json();

    expect(body.connections.map((row: { sessionName: string; kind: string }) => [row.sessionName, row.kind])).toEqual([
      ["signals-publish", "shared"],
      ["brand-x", "dedicated"],
    ]);
  });
});

describe("a platform setup RealTimeX blocks (ADR-547-7)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers 409 with the denial and its recovery", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    vi.stubEnv("RTX_APP_ID", "app-test");
    vi.stubEnv("RTX_API_BASE_URL", "http://127.0.0.1:3101");
    vi.stubEnv("SIGNALS_INSTANCE", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/cli/start-browser-session/")) {
          return new Response(
            JSON.stringify({
              success: false,
              reason: "guardrail-origin-not-allowed",
              error: "The RealTimeX Browser session does not allow https://www.linkedin.com.",
              guardrail: { action: "create-tab", targetOrigin: "https://www.linkedin.com", primaryOrigin: null },
            }),
            { status: 503 },
          );
        }
        return new Response(JSON.stringify({ success: true, sessions: [] }), { status: 200 });
      }),
    );

    const response = await SETUP_LINKEDIN(
      new NextRequest("http://localhost/api/platforms/linkedin/browser-session", {
        method: "POST",
        body: JSON.stringify({ action: "setup" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "RTX_NAVIGATION_BLOCKED",
      reason: "guardrail-origin-not-allowed",
      action: "create-tab",
      sessionName: "signals-publish",
      connectionId: publish.id,
      deniedOrigin: "https://www.linkedin.com",
      requestedUrl: "https://www.linkedin.com/login",
      recoverable: true,
      recovery: { kind: "allow_origin", connectionId: publish.id, origin: "https://www.linkedin.com" },
    });
  });
});
