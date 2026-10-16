// @vitest-environment happy-dom

import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowedWebsitesCard } from "@/app/dashboard/settings/allowed-websites-card";
import { BlockedWebsiteCallouts } from "@/components/blocked-website-callout";
import type { RunNavigationDenial } from "@/lib/browser/navigation-blocked";

// The Radix select can't be driven in happy-dom; a native one keeps the card's own state and
// requests real. It records `disabled` so the test can see the card lock the selector.
const selectProps: { disabled?: boolean } = {};
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (v: string) => void; disabled?: boolean; children: ReactNode }) => {
    selectProps.disabled = disabled;
    return createElement("select", { value, onChange: (e: { target: { value: string } }) => onValueChange(e.target.value) }, children);
  },
  SelectContent: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectItem: ({ value }: { value: string }) => createElement("option", { value }, value),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));

const DEFAULTS = ["https://x.com", "https://www.linkedin.com", "https://lnkd.in", "https://www.facebook.com"];
const ORIGIN = "https://custom-a.example";
const CONNECTIONS = [
  { id: "a", sessionName: "brand-a", kind: "dedicated" },
  { id: "b", sessionName: "brand-b", kind: "dedicated" },
];
const view = (id: string, extra: object = {}) => ({
  connectionId: id,
  sessionName: `brand-${id}`,
  defaults: DEFAULTS,
  custom: [],
  effective: DEFAULTS,
  runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: true },
  ...extra,
});
const added = {
  origin: ORIGIN,
  status: "added",
  persisted: true,
  applied: true,
  effective: [...DEFAULTS, ORIGIN],
  runtime: { reachable: true, allowedOrigins: [...DEFAULTS, ORIGIN], applied: true },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const text = () => document.body.textContent ?? "";
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === name);
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderCard() {
  await act(async () => root.render(createElement(AllowedWebsitesCard)));
  await flush();
}

async function submit(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function choose(id: string) {
  const select = document.querySelector("select")!;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

describe("Settings results stay with the connection they changed (Review P2-1)", () => {
  it("locks the selector while a change is in flight, and keeps a late Add out of the other connection", async () => {
    let resolveAdd!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/browser-connections") return Promise.resolve(json({ connections: CONNECTIONS }));
        if (init?.method === "POST") return new Promise<Response>((resolve) => (resolveAdd = resolve));
        return Promise.resolve(json(view(url.includes("/a/") ? "a" : "b")));
      }),
    );
    await renderCard();

    await submit(ORIGIN);
    expect(selectProps.disabled).toBe(true);
    await choose("b");
    await act(async () => resolveAdd(json(added)));
    await flush();

    expect(selectProps.disabled).toBe(false);
    expect(document.querySelector(`button[aria-label="Remove ${ORIGIN}"]`)).toBeNull();
    expect(text()).toContain(`brand-a: Added ${ORIGIN}. The browser can open it now.`);
  });

  it("binds Undo to the connection a late Remove changed", async () => {
    let resolveRemove!: (response: Response) => void;
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/browser-connections") return Promise.resolve(json({ connections: CONNECTIONS }));
        if (init?.method === "DELETE") return new Promise<Response>((resolve) => (resolveRemove = resolve));
        if (init?.method === "POST") {
          posts.push(url);
          return Promise.resolve(json(added));
        }
        return Promise.resolve(
          json(
            url.includes("/a/")
              ? view("a", { custom: [{ origin: ORIGIN, source: "settings", addedAt: 1 }], effective: [...DEFAULTS, ORIGIN] })
              : view("b"),
          ),
        );
      }),
    );
    await renderCard();

    await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${ORIGIN}"]`)!.click());
    await choose("b");
    await act(async () =>
      resolveRemove(json({ origin: ORIGIN, removed: true, applied: true, effective: DEFAULTS, runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: true } })),
    );
    await flush();
    expect(text()).toContain(`brand-a: Removed ${ORIGIN}.`);

    await act(async () => button("Undo")!.click());
    await flush();
    expect(posts).toEqual(["/api/browser-connections/a/allowed-origins"]);
    expect(document.querySelector(`button[aria-label="Remove ${ORIGIN}"]`)).toBeNull();
  });
});

describe("Try again stays available when RealTimeX holds no list (Review P2-3)", () => {
  const noList = { reachable: true, allowedOrigins: null, applied: null };

  it("offers Try again after a saved website whose session couldn't be created", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/browser-connections") return Promise.resolve(json({ connections: [CONNECTIONS[0]] }));
        if (url.endsWith("/apply")) return Promise.resolve(json({ applied: true, effective: added.effective, runtime: added.runtime }));
        if (init?.method === "POST") return Promise.resolve(json({ ...added, applied: false, runtime: noList, error: "registry busy" }, 502));
        return Promise.resolve(json(view("a", { runtime: noList })));
      }),
    );
    await renderCard();
    expect(text()).not.toContain("Some changes aren't active yet");

    await submit(ORIGIN);
    await flush();
    expect(text()).toContain(`Saved ${ORIGIN}, but it isn't active yet.`);
    expect(text()).toContain("Some changes aren't active yet");
    expect(text()).toContain("Not active yet");

    await act(async () => button("Try again")!.click());
    await flush();
    expect(calls.at(-1)).toBe("POST /api/browser-connections/a/allowed-origins/apply");
    expect(text()).toContain("All changes are active.");
  });

  it("keeps Try again when RealTimeX comes back without the session", async () => {
    const saved = { effective: [...DEFAULTS, ORIGIN], custom: [{ origin: ORIGIN, source: "settings", addedAt: 1 }] };
    let gets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/browser-connections") return Promise.resolve(json({ connections: [CONNECTIONS[0]] }));
        gets += 1;
        const runtime = gets === 1 ? { reachable: false, allowedOrigins: null, applied: null } : noList;
        return Promise.resolve(json(view("a", { ...saved, runtime })));
      }),
    );
    await renderCard();
    expect(text()).toContain("Can't reach the RealTimeX Browser");

    await act(async () => button("Try again")!.click());
    await flush();
    expect(text()).toContain("Some changes aren't active yet");
    expect(button("Try again")).toBeTruthy();
  });
});

describe("the run callout uses Allow results even after a failed load (Review P2-2)", () => {
  const denial: RunNavigationDenial = {
    code: "RTX_NAVIGATION_BLOCKED",
    reason: "guardrail-origin-not-allowed",
    action: null,
    sessionName: "brand-a",
    connectionId: "a",
    deniedOrigin: ORIGIN,
    requestedUrl: null,
    recoverable: true,
    recovery: { kind: "allow_origin", connectionId: "a", origin: ORIGIN },
    sources: [],
  };

  async function allowAfterFailedLoad(response: Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "POST" ? Promise.resolve(response) : Promise.reject(new TypeError("fetch failed")),
      ),
    );
    await act(async () => root.render(createElement(BlockedWebsiteCallouts, { denials: [denial] })));
    await flush();
    await act(async () => button("Allow website…")!.click());
    await act(async () => button("Allow website")!.click());
    await flush();
  }

  it("shows Website allowed after a verified Allow", async () => {
    await allowAfterFailedLoad(json(added));

    expect(document.querySelector('[data-testid="blocked-website-callout"]')?.textContent).toContain("Website allowed");
    expect(button("Allow website…")).toBeUndefined();
  });

  it("shows saved but not active after a 502", async () => {
    await allowAfterFailedLoad(
      json({ ...added, applied: false, runtime: { reachable: true, allowedOrigins: DEFAULTS, applied: false } }, 502),
    );
    await act(async () => button("Close")!.click());
    await flush();

    const callout = document.querySelector('[data-testid="blocked-website-callout"]')?.textContent ?? "";
    expect(callout).toContain("Saved, but not active yet");
    expect(callout).not.toContain("Website allowed");
  });
});
