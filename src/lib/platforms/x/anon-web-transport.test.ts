import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createXAnonWebSession,
  hydrateXProfilesViaAnonWeb,
  resetXAnonWebCooldownForTests,
} from "@/lib/platforms/x/anon-web-transport";
import type {
  XAnonBrowser,
  XAnonHandleResolverFactory,
  XAnonPageResult,
  XAnonResolveResult,
} from "@/lib/platforms/x/anon-browser-resolver";

const fixture = (name: string) =>
  readFileSync(new URL(`./web-fixtures/${name}`, import.meta.url), "utf8");

const fullProfile = fixture("full-profile.html");
/** Real anonymous render: no JSON-LD, ID recoverable only from the banner URL. */
const anonProfile = fixture("anon-rendered-profile.html");
/** Real anonymous render of an account with no banner, so no numeric ID at all. */
const anonNoBanner = fixture("anon-rendered-no-banner.html");

function profileHtml(userId: string, handle: string): string {
  return fullProfile.replaceAll("568879807", userId).replaceAll("tri_dao", handle);
}

function okPage(html = fullProfile, httpStatus = 200): XAnonPageResult {
  return { status: "ok", html, finalUrl: "https://x.com/tri_dao", httpStatus };
}

type BrowserStub = {
  resolve?: (userId: string) => Promise<XAnonResolveResult>;
  fetchProfile?: (handle: string) => Promise<XAnonPageResult>;
  capturePage?: (handle: string) => Promise<XAnonPageResult>;
};

function browserFactory(stub: BrowserStub) {
  const unavailable = async (): Promise<XAnonPageResult> =>
    ({ status: "unavailable", message: "not stubbed" });
  const unresolvable = async (): Promise<XAnonResolveResult> =>
    ({ status: "unavailable", message: "not stubbed" });
  const dispose = vi.fn(async () => undefined);
  const browser: XAnonBrowser = {
    resolve: vi.fn(stub.resolve ?? unresolvable),
    fetchProfile: vi.fn(stub.fetchProfile ?? unavailable),
    capturePage: vi.fn(stub.capturePage ?? (async () => okPage())),
    dispose,
  };
  const factory: XAnonHandleResolverFactory = vi.fn(async () => browser);
  return { browser, factory, dispose };
}

/** `fetchImpl` only reaches the RTX session API, so any transport call through it is a bug. */
const forbiddenFetch = () => vi.fn<typeof fetch>(async () => {
  throw new Error("the anonymous transport must not fetch profiles over HTTP");
});

const deps = (resolver?: XAnonHandleResolverFactory) => ({
  fetchImpl: forbiddenFetch(),
  env: {},
  resolver,
  minRequestGapMs: 0,
  random: () => 0,
  sleep: async () => undefined,
});

describe("hydrateXProfilesViaAnonWeb", () => {
  beforeEach(() => resetXAnonWebCooldownForTests());

  it("hydrates a handle-only request and reports the ID the profile page carries", async () => {
    const { browser, factory } = browserFactory({ fetchProfile: async () => okPage() });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:tri_dao", knownHandle: "@tri_dao", handleOnly: true }],
      deps(factory),
    );
    expect(outcomes.get("handle:tri_dao")).toMatchObject({
      status: "hydrated",
      user: { id: "568879807", username: "tri_dao" },
      resolvedHandle: "tri_dao",
    });
    expect(browser.fetchProfile).toHaveBeenCalledWith("tri_dao");
    expect(browser.resolve).not.toHaveBeenCalled();
  });

  it("hydrates a real anonymous render that carries no JSON-LD", async () => {
    const { factory } = browserFactory({ fetchProfile: async () => okPage(anonProfile) });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:DrJimFan", knownHandle: "DrJimFan", handleOnly: true }],
      deps(factory),
    );
    expect(outcomes.get("handle:DrJimFan")).toMatchObject({
      status: "hydrated",
      user: {
        id: "1007413134",
        username: "DrJimFan",
        name: "Jim Fan",
        profile_image_url:
          "https://pbs.twimg.com/profile_images/1554922493101559808/SYSZhbcd_normal.jpg",
      },
    });
  });

  it("hydrates an account with no banner even though the page names no numeric ID", async () => {
    const { factory } = browserFactory({ fetchProfile: async () => okPage(anonNoBanner) });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:sama", knownHandle: "sama", handleOnly: true }],
      deps(factory),
    );
    const outcome = outcomes.get("handle:sama");
    expect(outcome).toMatchObject({ status: "hydrated", user: { username: "sama", name: "Sam Altman" } });
    expect(outcome?.status === "hydrated" && outcome.user.id).toBeUndefined();
  });

  it("skips a handle-only request whose handle is not a usable X handle", async () => {
    const { browser, factory } = browserFactory({});
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:bad", knownHandle: "not a handle", handleOnly: true }],
      deps(factory),
    );
    expect(outcomes.get("handle:bad")).toEqual({ status: "skip", reason: "x_handle_invalid" });
    expect(browser.fetchProfile).not.toHaveBeenCalled();
    // Opening a browser to look up a handle that cannot exist is pure cost.
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses a known handle without resolving when the page confirms the numeric ID", async () => {
    const { browser, factory } = browserFactory({ fetchProfile: async () => okPage() });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "@tri_dao" }],
      deps(factory),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "hydrated",
      user: { id: "568879807", username: "tri_dao", name: "Tri Dao" },
    });
    expect(browser.resolve).not.toHaveBeenCalled();
  });

  it("re-resolves a known handle whose page names a different numeric ID", async () => {
    const { browser, factory } = browserFactory({
      fetchProfile: async () => okPage(profileHtml("999", "old_handle")),
      resolve: async () => ({ status: "resolved", handle: "tri_dao" }),
      capturePage: async () => okPage(),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "old_handle" }],
      deps(factory),
    );
    expect(browser.resolve).toHaveBeenCalledWith("568879807");
    expect(outcomes.get("568879807")).toMatchObject({ status: "hydrated", resolvedHandle: "tri_dao" });
  });

  it("re-resolves a known handle whose page names no numeric ID to verify against", async () => {
    const { browser, factory } = browserFactory({
      // A banner-less page cannot prove the handle still belongs to this ID.
      fetchProfile: async () => okPage(anonNoBanner),
      resolve: async () => ({ status: "resolved", handle: "tri_dao" }),
      capturePage: async () => okPage(),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "sama" }],
      deps(factory),
    );
    expect(browser.resolve).toHaveBeenCalledWith("568879807");
    expect(outcomes.get("568879807")).toMatchObject({
      status: "hydrated",
      user: { id: "568879807" },
      resolvedHandle: "tri_dao",
    });
  });

  it("reads the page the resolver already landed on instead of navigating twice", async () => {
    const { browser, factory, dispose } = browserFactory({
      resolve: async () => ({ status: "resolved", handle: "tri_dao" }),
      capturePage: async () => okPage(),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb([{ userId: "568879807" }], deps(factory));
    expect(outcomes.get("568879807")).toMatchObject({ status: "hydrated", resolvedHandle: "tri_dao" });
    expect(browser.capturePage).toHaveBeenCalledWith("tri_dao");
    expect(browser.fetchProfile).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("reuses one browser across contact-major calls and disposes it exactly once", async () => {
    const { browser, factory, dispose } = browserFactory({
      resolve: async () => ({ status: "resolved", handle: "tri_dao" }),
      capturePage: async () => okPage(),
    });
    const session = createXAnonWebSession(deps(factory));

    await session.hydrate([{ userId: "568879807" }]);
    await session.hydrate([{ userId: "568879807" }]);
    await session.dispose();
    await session.dispose();

    expect(factory).toHaveBeenCalledOnce();
    expect(browser.resolve).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not cap browser resolutions below the pipeline batch limit", async () => {
    const { browser, factory, dispose } = browserFactory({
      resolve: async (userId) => ({ status: "resolved", handle: `person${userId}` }),
      capturePage: async (handle) => okPage(profileHtml(handle.slice("person".length), handle)),
    });
    const session = createXAnonWebSession(deps(factory));
    const userIds = Array.from({ length: 12 }, (_, index) => String(1_000 + index));
    const outcomes = [];

    for (const userId of userIds) {
      outcomes.push((await session.hydrate([{ userId }])).get(userId));
    }
    await session.dispose();

    expect(outcomes.every((outcome) => outcome?.status === "hydrated")).toBe(true);
    expect(browser.resolve).toHaveBeenCalledTimes(12);
    expect(browser.capturePage).toHaveBeenCalledTimes(12);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("reports a 404 profile page as a miss", async () => {
    const { factory } = browserFactory({
      fetchProfile: async () => ({
        status: "ok",
        html: "<html><head><title>X</title></head><body></body></html>",
        finalUrl: "https://x.com/gone",
        httpStatus: 404,
      }),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "handle:gone", knownHandle: "gone", handleOnly: true }],
      deps(factory),
    );
    expect(outcomes.get("handle:gone")).toMatchObject({ status: "miss", missStatus: "not_found" });
  });

  it("reports a redirect away from the requested profile", async () => {
    const { factory } = browserFactory({
      resolve: async () => ({ status: "resolved", handle: "tri_dao" }),
      capturePage: async () => ({ status: "unexpected_redirect" }),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb([{ userId: "568879807" }], deps(factory));
    expect(outcomes.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_unexpected_redirect",
    });
  });

  it("aborts the batch on session contamination without reading any page", async () => {
    const { browser, factory } = browserFactory({ resolve: async () => ({ status: "contaminated" }) });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "1" }, { userId: "2" }],
      deps(factory),
    );
    expect([...outcomes.values()]).toEqual([
      { status: "skip", reason: "x_anon_session_contaminated" },
      { status: "skip", reason: "x_anon_session_contaminated" },
    ]);
    expect(browser.capturePage).not.toHaveBeenCalled();
  });

  it("trips on a rate limit and reports retry timing for the triggering request", async () => {
    const { browser, factory } = browserFactory({
      fetchProfile: async () => ({ status: "rate_limited", retryAfterSeconds: 90 }),
    });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [
        { userId: "568879807", knownHandle: "tri_dao" },
        { userId: "2", knownHandle: "person2" },
      ],
      deps(factory),
    );
    expect(outcomes.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_rate_limited",
      detail: { retryAfter: 90 },
    });
    expect(outcomes.get("2")).toEqual({ status: "skip", reason: "x_web_rate_limited" });
    expect(browser.fetchProfile).toHaveBeenCalledOnce();
  });

  it("omits retry timing when the rate limit carried none", async () => {
    const { factory } = browserFactory({ fetchProfile: async () => ({ status: "rate_limited" }) });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "568879807", knownHandle: "tri_dao" }],
      deps(factory),
    );
    expect(outcomes.get("568879807")).toEqual({ status: "skip", reason: "x_web_rate_limited" });
  });

  it("carries a breaker reason across contact-major calls without more traffic", async () => {
    const { browser, factory } = browserFactory({
      fetchProfile: async () => ({ status: "rate_limited", retryAfterSeconds: 90 }),
    });
    const session = createXAnonWebSession(deps(factory));

    const first = await session.hydrate([{ userId: "568879807", knownHandle: "tri_dao" }]);
    const second = await session.hydrate([{ userId: "2", knownHandle: "person2" }]);
    await session.dispose();

    expect(first.get("568879807")).toMatchObject({
      status: "skip",
      reason: "x_web_rate_limited",
      detail: { retryAfter: 90 },
    });
    expect(second.get("2")).toEqual({ status: "skip", reason: "x_web_rate_limited" });
    expect(browser.fetchProfile).toHaveBeenCalledOnce();
  });

  it("defers a later session while a breaker cooldown is active", async () => {
    const now = () => 1_000;
    const first = browserFactory({
      fetchProfile: async () => ({ status: "rate_limited" }),
    });
    const firstSession = createXAnonWebSession({ ...deps(first.factory), now });
    await firstSession.hydrate([{ userId: "1", knownHandle: "person1" }]);
    await firstSession.dispose();

    const second = browserFactory({ capturePage: async () => okPage() });
    const secondSession = createXAnonWebSession({ ...deps(second.factory), now });
    const deferred = await secondSession.hydrate([{ userId: "2" }]);
    await secondSession.dispose();

    expect(deferred.get("2")).toEqual({
      status: "skip",
      reason: "x_web_deferred",
      detail: { cooldownReason: "x_web_rate_limited" },
    });
    expect(second.factory).not.toHaveBeenCalled();
  });

  it("skips the batch when the anonymous browser cannot start", async () => {
    const factory: XAnonHandleResolverFactory = vi.fn(async () => {
      throw new Error("RTX browser session unavailable");
    });
    const outcomes = await hydrateXProfilesViaAnonWeb(
      [{ userId: "1" }, { userId: "2" }],
      deps(factory),
    );
    expect(outcomes.get("1")).toMatchObject({
      status: "skip",
      reason: "x_web_unavailable",
      detail: { message: "RTX browser session unavailable" },
    });
    expect(outcomes.get("2")).toEqual({ status: "skip", reason: "x_web_unavailable" });
  });
});
