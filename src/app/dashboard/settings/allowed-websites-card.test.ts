// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowedWebsitesCard } from "@/app/dashboard/settings/allowed-websites-card";
import type { AllowedOriginsView } from "@/lib/browser/allowed-websites-types";

const DEFAULTS = ["https://x.com", "https://www.linkedin.com", "https://lnkd.in", "https://www.facebook.com"];
const PUBLISH = { id: "bc_publish", sessionName: "signals-publish", kind: "shared" };
const TODAY = Math.floor(Date.now() / 1000);

function view(overrides: Partial<AllowedOriginsView> = {}): AllowedOriginsView {
  const custom = overrides.custom ?? [];
  const effective = [...DEFAULTS, ...custom.map((row) => row.origin)];
  return {
    connectionId: "bc_publish",
    sessionName: "signals-publish",
    defaults: DEFAULTS,
    custom,
    effective,
    runtime: { reachable: true, allowedOrigins: effective, applied: true },
    ...overrides,
  };
}

type Reply = { status: number; body: unknown } | "network";
type Call = { method: string; url: string; body: unknown };

function mockApi(routes: {
  connections?: Reply;
  get?: Reply[];
  post?: Reply[];
  remove?: Reply[];
  apply?: Reply[];
}) {
  const calls: Call[] = [];
  const queues = {
    get: [...(routes.get ?? [])],
    post: [...(routes.post ?? [])],
    remove: [...(routes.remove ?? [])],
    apply: [...(routes.apply ?? [])],
  };
  const next = (queue: Reply[]) => (queue.length > 1 ? queue.shift()! : queue[0]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply =
        url === "/api/browser-connections"
          ? (routes.connections ?? { status: 200, body: { connections: [PUBLISH] } })
          : url.endsWith("/apply")
            ? next(queues.apply)
            : method === "DELETE"
              ? next(queues.remove)
              : method === "POST"
                ? next(queues.post)
                : next(queues.get);
      if (!reply || reply === "network") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
  return calls;
}

const text = () => document.body.textContent ?? "";
const input = () => document.querySelector("input") as HTMLInputElement;
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  ) as HTMLButtonElement;
const status = () => [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" ");

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Settings → Platforms → Allowed websites (contract §1)", () => {
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

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function render() {
    await act(async () => {
      root.render(createElement(AllowedWebsitesCard));
    });
    await settle();
  }

  async function submit(value: string) {
    await act(async () => type(value));
    await act(async () => {
      input().closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  it("shows the no-publishing sentence, the one connection, an empty list and the four defaults", async () => {
    mockApi({ get: [{ status: 200, body: view() }] });
    await render();

    expect(text()).toContain("Allowing a website only lets the browser open it. It doesn't let Signals publish, message or take any other action there.");
    expect(text()).toContain("Applies to the browser connection signals-publish.");
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(text()).toContain("You haven't added any websites. When a run is blocked by a website, you can allow it from the run.");
    const defaults = [...document.querySelectorAll("ul")].at(-1)!;
    expect([...defaults.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "https://x.comX",
      "https://www.linkedin.comLinkedIn",
      "https://lnkd.inLinkedIn short links",
      "https://www.facebook.comFacebook",
    ]);
  });

  it("adds a pasted link's website, names the normalized origin and clears the field", async () => {
    const origin = "https://xn--bcher-kva.example";
    const after = [...DEFAULTS, origin];
    const calls = mockApi({
      get: [{ status: 200, body: view() }],
      post: [
        {
          status: 200,
          body: {
            origin,
            status: "added",
            persisted: true,
            applied: true,
            effective: after,
            runtime: { reachable: true, allowedOrigins: after, applied: true },
          },
        },
      ],
    });
    await render();

    await submit("https://bücher.example/katalog");

    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      url: "https://bücher.example/katalog",
      source: "settings",
    });
    expect(status()).toContain("Added https://xn--bcher-kva.example. The browser can open it now.");
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
    expect(text()).toContain("Added today");
  });

  it("shows a field error on submit and clears it while typing", async () => {
    mockApi({
      get: [{ status: 200, body: view() }],
      post: [{ status: 400, body: { code: "credentials_not_allowed", error: "" } }],
    });
    await render();

    await submit("https://user:pass@example.com");

    expect(text()).toContain("Remove the username and password from the link, then add it again.");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);

    await act(async () => type("https://example.com"));
    expect(text()).not.toContain("Remove the username and password");
    expect(input().getAttribute("aria-invalid")).toBeNull();
  });

  it("marks a saved website Not active yet and offers Try again after a 502", async () => {
    const saved = [...DEFAULTS, "https://example.org"];
    mockApi({
      get: [{ status: 200, body: view() }],
      post: [
        {
          status: 502,
          body: {
            origin: "https://example.org",
            status: "added",
            persisted: true,
            applied: false,
            effective: saved,
            runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false },
            error: "busy",
          },
        },
      ],
      apply: [{ status: 200, body: { applied: true, effective: saved, runtime: { reachable: true, allowedOrigins: saved, applied: true } } }],
    });
    await render();

    await submit("https://example.org/page");

    expect(status()).toContain("Saved https://example.org, but it isn't active yet.");
    expect(text()).toContain("Some changes aren't active yet");
    expect(text()).toContain("Not active yet");
    // Saved, so the field is cleared; Try again is in the alert (experience review r1).
    expect(input().value).toBe("");

    button("Try again").focus();
    await act(async () => button("Try again").click());
    await settle();
    expect(status()).toContain("All changes are active.");
    expect(document.activeElement).toBe(input());
    expect(text()).not.toContain("Some changes aren't active yet");
    expect(text()).not.toContain("Not active yet");
  });

  it("shows one unreachable alert and no row badges when RealTimeX can't be reached", async () => {
    mockApi({
      get: [
        {
          status: 200,
          body: view({
            custom: [{ origin: "https://example.org", source: "settings", addedAt: TODAY }],
            runtime: { reachable: false, allowedOrigins: null, applied: null },
          }),
        },
      ],
    });
    await render();

    expect(text()).toContain("Can't reach the RealTimeX Browser");
    expect(text()).toContain("Your list is saved. Changes take effect when the RealTimeX Browser is available.");
    expect(text()).not.toContain("Not active yet");
    expect(text()).not.toContain("active.");
  });

  it("removes a website at once, offers Undo and moves focus to the next Remove button", async () => {
    const custom = [
      { origin: "https://a.example", source: "settings" as const, addedAt: TODAY },
      { origin: "https://b.example", source: "recovery" as const, addedAt: TODAY },
    ];
    const afterRemove = [...DEFAULTS, "https://b.example"];
    mockApi({
      get: [{ status: 200, body: view({ custom }) }],
      remove: [
        {
          status: 200,
          body: {
            origin: "https://a.example",
            removed: true,
            applied: true,
            effective: afterRemove,
            runtime: { reachable: true, allowedOrigins: afterRemove, applied: true },
          },
        },
      ],
      post: [
        {
          status: 200,
          body: {
            origin: "https://a.example",
            status: "added",
            persisted: true,
            applied: true,
            effective: [...afterRemove, "https://a.example"],
            runtime: { reachable: true, allowedOrigins: [...afterRemove, "https://a.example"], applied: true },
          },
        },
      ],
    });
    await render();
    expect(text()).toContain("Added today from a blocked run");

    await act(async () => button("Remove https://a.example").click());
    await settle();

    expect(status()).toContain("Removed https://a.example.");
    expect(button("Remove https://a.example")).toBeUndefined();
    expect(document.activeElement).toBe(button("Remove https://b.example"));

    await act(async () => button("Undo").click());
    await settle();
    expect(status()).toContain("Added https://a.example back.");
    expect(document.activeElement).toBe(button("Remove https://a.example"));
  });

  it("says the Dev copy can't change signals-publish when Remove is refused", async () => {
    mockApi({
      get: [{ status: 200, body: view({ custom: [{ origin: "https://a.example", source: "settings", addedAt: TODAY }] }) }],
      remove: [{ status: 403, body: { code: "DEV_INSTANCE_GUARD" } }],
    });
    await render();

    await act(async () => button("Remove https://a.example").click());
    await settle();

    expect(status()).toContain("This development copy of Signals can't change signals-publish.");
    expect(document.activeElement).toBe(button("Remove https://a.example"));
  });

  it("keeps focus on the alert's Try again when RealTimeX refuses again", async () => {
    const saved = [...DEFAULTS, "https://example.org"];
    mockApi({
      get: [
        {
          status: 200,
          body: view({
            custom: [{ origin: "https://example.org", source: "settings", addedAt: TODAY }],
            runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false },
          }),
        },
      ],
      apply: [{ status: 502, body: { applied: false, effective: saved, runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false } } }],
    });
    await render();
    const tryAgain = button("Try again");
    tryAgain.focus();

    await act(async () => tryAgain.click());
    await settle();

    expect(status()).toContain("Still not active. The RealTimeX Browser didn't accept the update.");
    expect(document.activeElement).toBe(button("Try again"));
    expect(button("Try again").hasAttribute("disabled")).toBe(false);
  });

  it("reports each unreachable Try again: still down, then back but not active", async () => {
    const custom = [{ origin: "https://example.org", source: "settings" as const, addedAt: TODAY }];
    const down = view({ custom, runtime: { reachable: false, allowedOrigins: null, applied: null } });
    const backNotActive = view({ custom, runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false } });
    mockApi({
      get: [{ status: 200, body: down }, { status: 200, body: down }, { status: 200, body: backNotActive }],
      post: [
        {
          status: 502,
          body: {
            origin: "https://other.example",
            status: "added",
            persisted: true,
            applied: false,
            effective: [...DEFAULTS, "https://example.org", "https://other.example"],
            runtime: { reachable: false, allowedOrigins: null, applied: null },
          },
        },
      ],
    });
    await render();
    await submit("https://other.example");
    expect(status()).toContain("It takes effect when the RealTimeX Browser is available.");

    button("Try again").focus();
    await act(async () => button("Try again").click());
    await settle();
    expect(status()).toBe("The RealTimeX Browser still isn't responding.");
    expect(document.activeElement).toBe(button("Try again"));

    await act(async () => button("Try again").click());
    await settle();
    expect(text()).toContain("Some changes aren't active yet");
    // The alert speaks now; the stale "…when the RealTimeX Browser is available." line is gone.
    expect(status()).toBe("");
    expect(document.activeElement).toBe(button("Try again"));
  });

  it("shows a selector with two connections", async () => {
    mockApi({
      connections: {
        status: 200,
        body: { connections: [PUBLISH, { id: "bc_brand", sessionName: "brand-x", kind: "dedicated" }] },
      },
      get: [{ status: 200, body: view() }],
    });
    await render();

    expect(document.querySelector('[role="combobox"]')).toBeTruthy();
    expect(text()).toContain("Each connection keeps its own list. The websites Signals always allows apply to every connection.");
    expect(text()).not.toContain("Applies to the browser connection");
  });

  it("creates the shared connection's row on first use", async () => {
    let listed = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/browser-connections") {
          listed += 1;
          return new Response(JSON.stringify({ connections: listed === 1 ? [] : [PUBLISH] }), { status: 200 });
        }
        if (url === "/api/platform-targets/connections") {
          expect(JSON.parse(String(init?.body))).toEqual({ sessionName: "signals-publish", kind: "shared" });
          return new Response(JSON.stringify({ connection: PUBLISH }), { status: 200 });
        }
        return new Response(JSON.stringify(view()), { status: 200 });
      }),
    );
    await render();

    expect(listed).toBe(2);
    expect(text()).toContain("Applies to the browser connection signals-publish.");
  });

  it("reports a failed load, changes nothing, and retries", async () => {
    mockApi({ get: ["network", { status: 200, body: view() }] });
    await render();

    expect(text()).toContain("Couldn't load allowed websites");
    expect(text()).toContain("Nothing was changed.");

    await act(async () => button("Retry").click());
    await settle();
    expect(text()).toContain("Always allowed by Signals");
    expect(document.activeElement).toBe(input());
  });
});
