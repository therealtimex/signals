import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createXAnonWebSession,
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

function profileHtml(userId: string, handle: string): string {
  return fullProfile
    .replaceAll("568879807", userId)
    .replaceAll("tri_dao", handle);
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

  it("hydrates a handle-only request and reports the ID the profile page carries", async () => {
    const fetchImpl = safeFetch(htmlResponse());
    const resolver = vi.fn<XAnonHandleResolverFactory>();
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:tri_dao", knownHandle: "@tri_dao", handleOnly: true }],
      deps(fetchImpl, resolver),
    );
    expect(outcomes.get("handle:tri_dao")).toMatchObject({
      status: "hydrated",
      user: { id: "568879807", username: "tri_dao" },
      resolvedHandle: "tri_dao",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("skips a handle-only request whose handle is not a usable X handle", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = vi.fn<XAnonHandleResolverFactory>();
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:bad", knownHandle: "not a handle", handleOnly: true }],
      deps(fetchImpl, resolver),
    );
    expect(outcomes.get("handle:bad")).toEqual({ status: "skip", reason: "x_handle_invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

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

  it("reuses one resolver across contact-major calls and disposes it exactly once", async () => {
    const resolve = vi.fn(async () => ({ status: "resolved" as const, handle: "tri_dao" }));
    const { factory, dispose } = resolverFactory(resolve);
    const session = createXAnonWebSession(deps(safeFetch(htmlResponse()), factory));

    await session.hydrate([{ userId: "568879807" }]);
    await session.hydrate([{ userId: "568879807" }]);
    await session.dispose();
    await session.dispose();

    expect(factory).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not cap browser resolutions below the pipeline batch limit", async () => {
    const resolve = vi.fn(async (userId: string) => ({
      status: "resolved" as const,
      handle: `person${userId}`,
    }));
    const { factory, dispose } = resolverFactory(resolve);
    const fetchImpl = safeFetch((url) => {
      const handle = new URL(url).pathname.slice(1);
      return htmlResponse(profileHtml(handle.slice("person".length), handle));
    });
    const session = createXAnonWebSession(deps(fetchImpl, factory));
    const userIds = Array.from({ length: 12 }, (_, index) => String(1_000 + index));
    const outcomes = [];

    for (const userId of userIds) {
      outcomes.push((await session.hydrate([{ userId }])).get(userId));
    }
    await session.dispose();

    expect(outcomes.every((outcome) => outcome?.status === "hydrated")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(12);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("defers a later session while a breaker cooldown is active", async () => {
    const now = () => 1_000;
    const firstFetch = safeFetch(new Response("", {
      status: 429,
      headers: { "content-type": "text/html" },
    }));
    const firstSession = createXAnonWebSession({ ...deps(firstFetch), now });

    await firstSession.hydrate([{ userId: "1", knownHandle: "person1" }]);
    await firstSession.dispose();

    const secondFetch = safeFetch(htmlResponse());
    const secondSession = createXAnonWebSession({ ...deps(secondFetch), now });
    const deferred = await secondSession.hydrate([{ userId: "2" }]);
    await secondSession.dispose();

    expect(deferred.get("2")).toEqual({
      status: "skip",
      reason: "x_web_deferred",
      detail: { cooldownReason: "x_web_rate_limited" },
    });
    expect(secondFetch).not.toHaveBeenCalled();
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

  it("carries a breaker reason across contact-major calls without more traffic", async () => {
    const fetchImpl = safeFetch(new Response("", {
      status: 429,
      headers: { "content-type": "text/html", "retry-after": "90" },
    }));
    const session = createXAnonWebSession(deps(fetchImpl));

    const first = await session.hydrate([{ userId: "568879807", knownHandle: "tri_dao" }]);
    const second = await session.hydrate([{ userId: "2", knownHandle: "person2" }]);
    await session.dispose();

    expect(first.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_rate_limited",
      detail: { retryAfter: 90 },
    });
    expect(second.get("2")).toEqual({ status: "skip", reason: "x_web_rate_limited" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to x-rate-limit-reset when Retry-After is absent", async () => {
    const fetchImpl = safeFetch(new Response("", {
      status: 429,
      headers: { "content-type": "text/html", "x-rate-limit-reset": "1090" },
    }));
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "tri_dao" }],
      { ...deps(fetchImpl), now: () => 1_000_000 },
    );
    expect(outcomes.get("568879807")).toEqual({
      status: "skip",
      reason: "x_web_rate_limited",
      detail: { retryAfter: 90 },
    });
  });

  it("omits retry timing when a 429 has neither rate-limit header", async () => {
    const fetchImpl = safeFetch(new Response("", {
      status: 429,
      headers: { "content-type": "text/html" },
    }));
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "tri_dao" }],
      deps(fetchImpl),
    );
    expect(outcomes.get("568879807")).toEqual({
      status: "skip",
      reason: "x_web_rate_limited",
    });
  });
});
