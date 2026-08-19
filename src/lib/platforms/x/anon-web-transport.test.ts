import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateXProfilesViaAnonWeb,
  resetXAnonWebCooldownForTests,
} from "@/lib/platforms/x/anon-web-transport";
import type {
  XAnonHandleResolver,
  XAnonHandleResolverFactory,
} from "@/lib/platforms/x/anon-browser-resolver";

const fullProfile = readFileSync(
  new URL("./web-fixtures/full-profile.html", import.meta.url),
  "utf8",
);

function htmlResponse(html = fullProfile, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html", ...(init.headers ?? {}) },
    ...init,
  });
}

function safeFetch(response: Response | ((url: string) => Response)) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(new URL(url).origin).toBe("https://x.com");
    const headers = new Headers(init?.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("user-agent")).toBe("curl/8.7.1");
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
    return typeof response === "function" ? response(url) : response.clone();
  });
}

function resolverFactory(
  resolve: XAnonHandleResolver["resolve"],
): { factory: XAnonHandleResolverFactory; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn(async () => undefined);
  return {
    dispose,
    factory: vi.fn(async () => ({ resolve, dispose })),
  };
}

const deps = (fetchImpl: typeof fetch, resolver?: XAnonHandleResolverFactory) => ({
  fetchImpl,
  env: {},
  resolver,
  minRequestGapMs: 0,
  random: () => 0,
  sleep: async () => undefined,
});

describe("hydrateXProfilesViaAnonWeb", () => {
  beforeEach(() => resetXAnonWebCooldownForTests());

  it("uses a known handle without opening a browser and sends no credentials", async () => {
    const fetchImpl = safeFetch(htmlResponse());
    const resolver = vi.fn<XAnonHandleResolverFactory>();
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "@tri_dao" }],
      deps(fetchImpl, resolver),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "hydrated",
      user: { id: "568879807", username: "tri_dao", name: "Tri Dao" },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves numeric-only identities in the anonymous browser before fetching", async () => {
    const { factory, dispose } = resolverFactory(async () => ({ status: "resolved", handle: "tri_dao" }));
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807" }],
      deps(safeFetch(htmlResponse()), factory),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "hydrated",
      resolvedHandle: "tri_dao",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("re-resolves a stale known handle and validates the numeric identifier", async () => {
    const { factory } = resolverFactory(async () => ({ status: "resolved", handle: "tri_dao" }));
    const fetchImpl = safeFetch(htmlResponse());
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "old_handle" }],
      deps(fetchImpl, factory),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(outcomes.get("568879807")).toMatchObject({ status: "hydrated", resolvedHandle: "tri_dao" });
  });

  it("rejects redirects away from the X origin", async () => {
    const fetchImpl = safeFetch(new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/profile" },
    }));
    const { factory } = resolverFactory(async () => ({ status: "resolved", handle: "tri_dao" }));
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807" }],
      deps(fetchImpl, factory),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_unexpected_redirect",
    });
  });

  it("aborts the batch on session contamination without issuing HTTP requests", async () => {
    const { factory } = resolverFactory(async () => ({ status: "contaminated" }));
    const fetchImpl = safeFetch(htmlResponse());
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "1" }, { userId: "2" }],
      deps(fetchImpl, factory),
    );
    expect([...outcomes.values()]).toEqual([
      { status: "skip", reason: "x_anon_session_contaminated" },
      { status: "skip", reason: "x_anon_session_contaminated" },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("trips on 429 and reports retry timing for the triggering request", async () => {
    const response = new Response("", {
      status: 429,
      headers: { "content-type": "text/html", "retry-after": "90" },
    });
    const fetchImpl = safeFetch(response);
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [
        { userId: "568879807", knownHandle: "tri_dao" },
        { userId: "2", knownHandle: "person2" },
      ],
      deps(fetchImpl),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_rate_limited",
      detail: { retryAfter: 90 },
    });
    expect(outcomes.get("2")).toEqual({ status: "skip", reason: "x_web_rate_limited" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
