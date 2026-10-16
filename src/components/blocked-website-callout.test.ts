// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowWebsiteDialog, type AllowWebsiteRetryOutcome } from "@/components/allow-website-dialog";
import { BlockedWebsiteCallouts } from "@/components/blocked-website-callout";
import type { AllowedOriginsView } from "@/lib/browser/allowed-websites-types";
import type { RunNavigationDenial } from "@/lib/browser/navigation-blocked";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const DEFAULTS = ["https://x.com", "https://www.linkedin.com", "https://lnkd.in", "https://www.facebook.com"];
const EVENTBRITE = "https://www.eventbrite.com";

function denial(overrides: Partial<RunNavigationDenial> = {}): RunNavigationDenial {
  return {
    code: "RTX_NAVIGATION_BLOCKED",
    reason: "guardrail-origin-not-allowed",
    action: null,
    sessionName: "signals-publish",
    connectionId: "bc_publish",
    deniedOrigin: EVENTBRITE,
    requestedUrl: "https://www.eventbrite.com/e/ai-founders-881204",
    recoverable: true,
    recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: EVENTBRITE },
    sources: ["The RealTimeX Browser session does not allow https://www.eventbrite.com."],
    ...overrides,
  };
}

function view(runtime: AllowedOriginsView["runtime"], effective = DEFAULTS): AllowedOriginsView {
  return { connectionId: "bc_publish", sessionName: "signals-publish", defaults: DEFAULTS, custom: [], effective, runtime };
}

type Reply = { status: number; body: unknown } | "network";
type Call = { method: string; url: string; body: unknown };

/** Route the allowed-websites API to queued replies and record every request. */
function mockApi(replies: { get?: Reply[]; post?: Reply[]; apply?: Reply[] }) {
  const calls: Call[] = [];
  const queues = { get: [...(replies.get ?? [])], post: [...(replies.post ?? [])], apply: [...(replies.apply ?? [])] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const queue = url.endsWith("/apply") ? queues.apply : method === "POST" ? queues.post : queues.get;
      const reply = queue.length > 1 ? queue.shift()! : queue[0];
      if (!reply || reply === "network") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
  return calls;
}

const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === name) as HTMLButtonElement;
const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("blocked-website callout (contract §2, §3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(denials: RunNavigationDenial[]) {
    await act(async () => {
      root.render(createElement(BlockedWebsiteCallouts, { denials }));
    });
    await flush();
  }

  it("shows nothing, and asks for nothing, when no denial is recoverable", async () => {
    const calls = mockApi({});
    await render([denial({ sessionName: "signals-scout-1", connectionId: null, recoverable: false, recovery: null })]);
    expect(container.innerHTML).toBe("");
    expect(calls).toEqual([]);
  });

  it("names the connection, the website and the blocked link, with one Allow action", async () => {
    mockApi({ get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }] });
    await render([denial()]);

    expect(text()).toContain("A website was blocked");
    expect(text()).toContain("The browser connection signals-publish isn't allowed to open https://www.eventbrite.com.");
    expect(text()).toContain("Blocked link: https://www.eventbrite.com/e/ai-founders-881204");
    expect(button("Allow website…")).toBeTruthy();
  });

  it("sends nothing on Cancel and returns focus to the button that opened the dialog", async () => {
    const calls = mockApi({ get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }] });
    await render([denial()]);
    const opener = button("Allow website…");

    await act(async () => opener.click());
    expect(text()).toContain("Allow this website?");
    expect(document.activeElement?.textContent?.trim()).toBe("Allow website");
    await act(async () => button("Cancel").click());
    await flush();

    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(text()).not.toContain("Allow this website?");
    expect(document.activeElement).toBe(opener);
  });

  it("allows the website, then says to start the workflow again and moves focus to the callout", async () => {
    const after = [...DEFAULTS, EVENTBRITE];
    const calls = mockApi({
      get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }],
      post: [
        {
          status: 200,
          body: {
            origin: EVENTBRITE,
            status: "added",
            persisted: true,
            applied: true,
            effective: after,
            runtime: { reachable: true, allowedOrigins: after, applied: true },
          },
        },
      ],
    });
    await render([denial()]);

    await act(async () => button("Allow website…").click());
    await act(async () => button("Allow website").click());
    await flush();

    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ url: EVENTBRITE, source: "recovery" });
    expect(text()).toContain("Website allowed");
    expect(text()).toContain("signals-publish can open https://www.eventbrite.com now. Start the workflow again to use the link.");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "https://www.eventbrite.com is allowed. Start the workflow again to use the link.",
    );
    expect(document.activeElement).toBe(document.querySelector('[data-testid="blocked-website-callout"]'));
    expect(document.querySelector('a[href*="#allowed-websites"]')?.getAttribute("href")).toBe(
      "/dashboard/settings?tab=platforms&connection=bc_publish#allowed-websites",
    );
  });

  it("keeps the website saved but not active after a 502, and never says navigation happened", async () => {
    const saved = [...DEFAULTS, EVENTBRITE];
    mockApi({
      get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }],
      post: [
        {
          status: 502,
          body: {
            origin: EVENTBRITE,
            status: "added",
            persisted: true,
            applied: false,
            effective: saved,
            runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false },
            error: "busy",
          },
        },
      ],
    });
    await render([denial()]);

    await act(async () => button("Allow website…").click());
    await act(async () => button("Allow website").click());
    await flush();

    expect(text()).toContain("Saved, but not active yet");
    expect(text()).toContain("The RealTimeX Browser didn't accept the update. Signals tries again the next time it uses this connection.");
    expect(document.activeElement?.textContent?.trim()).toBe("Try again");

    await act(async () => button("Close").click());
    await flush();
    expect(text()).toContain("Saved, but not active yet");
    expect(text()).toContain("still can't open https://www.eventbrite.com");
    expect(text()).not.toContain("Website allowed");
  });

  it("never reads Website allowed while RealTimeX is unreachable", async () => {
    mockApi({
      get: [{ status: 200, body: view({ reachable: false, allowedOrigins: null, applied: null }, [...DEFAULTS, EVENTBRITE]) }],
    });
    await render([denial()]);

    expect(text()).toContain("Saved, but not active yet");
    expect(text()).toContain(
      "Signals can't reach the RealTimeX Browser right now. https://www.eventbrite.com is saved for signals-publish and takes effect when the RealTimeX Browser is available.",
    );
    expect(text()).not.toContain("Website allowed");
  });

  it("reads Website allowed on load for a website RealTimeX already allows", async () => {
    mockApi({ get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }] });
    await render([
      denial({
        deniedOrigin: "https://lnkd.in",
        requestedUrl: null,
        recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: "https://lnkd.in" },
      }),
    ]);

    expect(text()).toContain("Website allowed");
    expect(button("Allow website…")).toBeUndefined();
  });

  it("lists two blocked websites with one Allow action each", async () => {
    mockApi({ get: [{ status: 200, body: view({ reachable: true, allowedOrigins: DEFAULTS, applied: true }) }] });
    await render([
      denial(),
      denial({
        deniedOrigin: "https://lu.ma",
        requestedUrl: null,
        recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: "https://lu.ma" },
      }),
    ]);

    expect(text()).toContain("2 websites were blocked");
    expect(text()).toContain("The browser connection signals-publish isn't allowed to open these websites.");
    expect(document.querySelector('button[aria-label="Allow https://lu.ma…"]')).toBeTruthy();
    expect(document.querySelector('button[aria-label="Allow https://www.eventbrite.com…"]')).toBeTruthy();
  });
});

describe("allow dialog states (contract §3.1, §4)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderDialog(onRetry?: () => Promise<AllowWebsiteRetryOutcome>) {
    const onAllowed = vi.fn();
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(AllowWebsiteDialog, {
          open: true,
          onOpenChange,
          connectionId: "bc_publish",
          sessionName: "signals-publish",
          origin: EVENTBRITE,
          requestedUrl: null,
          onChange: vi.fn(),
          onAllowed,
          onRetry,
        }),
      );
    });
    return { onAllowed, onOpenChange };
  }

  const ok = (origin: string) => ({
    status: 200,
    body: {
      origin,
      status: "added",
      persisted: true,
      applied: true,
      effective: [...DEFAULTS, origin],
      runtime: { reachable: true, allowedOrigins: [...DEFAULTS, origin], applied: true },
    },
  });

  it("explains a Dev instance refusal and saves nothing", async () => {
    mockApi({ post: [{ status: 403, body: { code: "DEV_INSTANCE_GUARD" } }] });
    await renderDialog();

    await act(async () => button("Allow website").click());
    await flush();

    expect(text()).toContain("Can't change signals-publish");
    expect(text()).toContain("This development copy of Signals can't change the shared publishing connection. Nothing was saved.");
    expect(button("Try again")).toBeUndefined();
    expect(document.activeElement?.textContent?.trim()).toBe("Close");
  });

  it("offers Try again when Signals doesn't respond, and re-sends the same request", async () => {
    const calls = mockApi({ post: ["network", ok(EVENTBRITE)] });
    const { onAllowed } = await renderDialog();

    await act(async () => button("Allow website").click());
    await flush();
    expect(text()).toContain("Couldn't allow the website");
    expect(text()).toContain("Signals didn't respond. Nothing was saved.");

    await act(async () => button("Try again").click());
    await flush();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    expect(onAllowed).toHaveBeenCalledWith(EVENTBRITE);
  });

  it("asks again for a second blocked website, one click at a time", async () => {
    mockApi({ post: [ok(EVENTBRITE)] });
    const onRetry = vi.fn(async (): Promise<AllowWebsiteRetryOutcome> => ({
      kind: "blocked",
      origin: "https://cdn.evbstatic.com",
      requestedUrl: null,
    }));
    await renderDialog(onRetry);

    await act(async () => button("Allow website and retry").click());
    await flush();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Allow another website?");
    expect(text()).toContain(
      "https://www.eventbrite.com is allowed. Opening the page then needed another website, which is also blocked.",
    );
    expect(document.querySelector('[data-testid="allow-website-origin"]')?.textContent).toBe("https://cdn.evbstatic.com");
    expect(button("Allow website and retry")).toBeTruthy();
  });

  it("reports a page that fails to open for another reason, without re-saving on Try again", async () => {
    const calls = mockApi({ post: [ok(EVENTBRITE)] });
    const onRetry = vi
      .fn<() => Promise<AllowWebsiteRetryOutcome>>()
      .mockResolvedValueOnce({ kind: "failed", reason: "the tab crashed" })
      .mockResolvedValueOnce({ kind: "opened" });
    const { onOpenChange } = await renderDialog(onRetry);

    await act(async () => button("Allow website and retry").click());
    await flush();
    expect(text()).toContain("The page didn't open");
    expect(text()).toContain("https://www.eventbrite.com is allowed, but opening the page failed: the tab crashed.");

    await act(async () => button("Try again").click());
    await flush();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("callout Try again keeps focus and reports (experience review r1)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const saved = [...DEFAULTS, EVENTBRITE];
  const notActive = view({ reachable: true, allowedOrigins: DEFAULTS, applied: false }, saved);
  const status = () => document.querySelector('[data-testid="blocked-website-callout"] [role="status"]')?.textContent;

  async function render(denials: RunNavigationDenial[]) {
    await act(async () => {
      root.render(createElement(BlockedWebsiteCallouts, { denials }));
    });
    await flush();
  }

  it("moves focus to the callout and announces when Try again makes the website active", async () => {
    mockApi({
      get: [{ status: 200, body: notActive }],
      apply: [{ status: 200, body: { applied: true, effective: saved, runtime: { reachable: true, allowedOrigins: saved, applied: true } } }],
    });
    await render([denial()]);
    const tryAgain = button("Try again");
    tryAgain.focus();

    await act(async () => tryAgain.click());
    await flush();

    expect(text()).toContain("Website allowed");
    expect(status()).toBe("https://www.eventbrite.com is allowed. Start the workflow again to use the link.");
    expect(document.activeElement).toBe(document.querySelector('[data-testid="blocked-website-callout"]'));
  });

  it("keeps focus on Try again and says it still isn't active after another refusal", async () => {
    mockApi({
      get: [{ status: 200, body: notActive }],
      apply: [{ status: 502, body: { applied: false, effective: saved, runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false } } }],
    });
    await render([denial()]);
    const tryAgain = button("Try again");
    tryAgain.focus();

    await act(async () => tryAgain.click());
    await flush();

    expect(status()).toBe("Still not active. The RealTimeX Browser didn't accept the update.");
    expect(document.activeElement).toBe(button("Try again"));
    expect(button("Try again").hasAttribute("disabled")).toBe(false);
  });

  it("says RealTimeX still isn't responding when a re-read finds it unreachable", async () => {
    const down = view({ reachable: false, allowedOrigins: null, applied: null }, saved);
    mockApi({ get: [{ status: 200, body: down }] });
    await render([denial()]);
    const tryAgain = button("Try again");
    tryAgain.focus();

    await act(async () => tryAgain.click());
    await flush();

    expect(status()).toBe("The RealTimeX Browser still isn't responding.");
    expect(document.activeElement).toBe(button("Try again"));
  });

  it("says these websites are allowed when the last blocked row becomes active", async () => {
    const both = [...DEFAULTS, EVENTBRITE, "https://lu.ma"];
    mockApi({
      get: [{ status: 200, body: view({ reachable: true, allowedOrigins: [...DEFAULTS, "https://lu.ma"], applied: false }, both) }],
      apply: [{ status: 200, body: { applied: true, effective: both, runtime: { reachable: true, allowedOrigins: both, applied: true } } }],
    });
    await render([
      denial(),
      denial({
        deniedOrigin: "https://lu.ma",
        requestedUrl: null,
        recovery: { kind: "allow_origin", connectionId: "bc_publish", origin: "https://lu.ma" },
      }),
    ]);

    await act(async () => button("Try again").click());
    await flush();

    expect(text()).toContain("Websites allowed");
    expect(status()).toBe("These websites are allowed. Start the workflow again to use them.");
  });
});
