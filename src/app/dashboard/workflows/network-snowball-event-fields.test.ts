// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkSnowballEventFields } from "@/app/dashboard/workflows/network-snowball-event-fields";
import {
  buildNetworkSnowballTemplateConfig,
  readNetworkSnowballConfig,
  type NetworkSnowballConfig,
} from "@/lib/workflows/network-snowball";

function initialConfig(seedValue = "https://luma.com/build-night"): NetworkSnowballConfig {
  return readNetworkSnowballConfig({
    ...buildNetworkSnowballTemplateConfig(),
    seedValue,
  });
}

function sessionResponse() {
  return new Response(JSON.stringify({
    sessions: [
      { sessionName: "personal-browser", running: true, sourceIdentity: null, identityVerification: "checked_at_launch" },
      { sessionName: "signals-publish", running: true, sourceIdentity: null, identityVerification: "checked_at_launch" },
    ],
    crmTarget: {
      platform: "linkedin",
      sessionName: "crm-linkedin",
      identity: "/in/operator",
      verification: "previously_verified",
      lastVerifiedAt: 1_700_000_000,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function previewResponse(input: {
  canonicalUrl: string;
  provider: "luma" | "generic";
  kind: "event" | "organization";
  title?: string;
}) {
  const signedInRead = input.provider === "luma";
  return new Response(JSON.stringify({
    preview: {
      resolvedSource: {
        version: 1,
        canonicalUrl: input.canonicalUrl,
        provider: input.provider,
        kind: input.kind,
        classification: { basis: "metadata", confidence: "high" },
        capabilities: { publicRead: true, signedInRead, participantExpansion: signedInRead },
      },
      accessPlan: {
        mode: "public_only",
        signedInRequested: false,
        signedInSupported: signedInRead,
        reason: null,
      },
      publicSource: input.title ? { title: input.title } : null,
      errors: [],
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("NetworkSnowballEventFields", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("source-sessions")) return sessionResponse();
      if (String(url).includes("source-preview")) return previewResponse({
        canonicalUrl: "https://luma.com/build-night",
        provider: "luma",
        kind: "event",
      });
      throw new Error(`Unexpected fetch: ${String(url)}`);
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.replaceChildren();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps consent explicit and reveals the exact session only after opt-in", async () => {
    let latest = initialConfig("https://luma.com/build-night");

    function Harness() {
      const [value, setValue] = useState(latest);
      latest = value;
      return createElement(NetworkSnowballEventFields, { value, onChange: setValue });
    }

    await act(async () => root.render(createElement(Harness)));

    const checkbox = container.querySelector("#snowball-participant-access") as HTMLButtonElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(checkbox.className).toContain("dark:data-[state=checked]:bg-primary");
    expect(container.textContent).toContain("Use registered guest access");
    expect(container.textContent).toContain("Luma");
    expect(container.textContent).not.toContain("Signals Publish");
    expect(container.textContent).not.toContain("signals-publish");
    expect(container.textContent).toContain("CRM write identity (separate)");
    expect(container.textContent).toContain("/in/operator");
    expect(container.textContent).toContain("crm-linkedin");

    await act(async () => checkbox.click());
    await act(async () => Promise.resolve());

    expect(latest.participantAccess).toEqual({
      enabled: true,
      browserSessionName: "signals-publish",
    });
    expect(container.textContent).toContain("signals-publish");
    expect(container.textContent).toContain("Source identity verification");
    expect(container.textContent).toContain("Not checked yet");
  });

  it("makes generic organization links public-only and hides event controls", async () => {
    const value = initialConfig("https://metr.org/about");
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value,
      onChange: () => undefined,
    })));
    expect(container.textContent).toContain("Generic");
    expect(container.textContent).toContain("Public-only source");
    expect(container.textContent).toContain("CRM write identity (separate)");
    expect(container.textContent).toContain("/in/operator");
    expect(container.textContent).toContain("crm-linkedin");
    expect(container.textContent).not.toContain("signals-publish");
    expect(container.querySelector("#snowball-participant-access")).toBeNull();
    expect(container.querySelector("#snowball-event-depth")).toBeNull();
    expect(container.querySelector("#snowball-max-events")).toBeNull();
  });

  it("debounces previews and cancels stale source requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("source-sessions")) return Promise.resolve(sessionResponse());
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }));
    const first = initialConfig("https://x.com/acme/status/1");
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value: first,
      onChange: () => undefined,
    })));
    await act(async () => vi.advanceTimersByTime(451));
    expect(signals).toHaveLength(1);

    const second = { ...first, seedValue: "https://linkedin.com/company/acme" };
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value: second,
      onChange: () => undefined,
    })));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTime(451));
    expect(signals).toHaveLength(2);
  });

  it("ignores an older preview that settles after a newer source", async () => {
    vi.useFakeTimers();
    let resolveLuma!: (response: Response) => void;
    let resolveMetr!: (response: Response) => void;
    const lumaRequest = new Promise<Response>((resolve) => { resolveLuma = resolve; });
    const metrRequest = new Promise<Response>((resolve) => { resolveMetr = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("source-sessions")) return Promise.resolve(sessionResponse());
      const request = JSON.parse(String(init?.body)) as { sourceUrl: string };
      return request.sourceUrl.includes("luma.com") ? lumaRequest : metrRequest;
    }));
    let readiness: { ready: boolean; sourceValue: string } | undefined;
    const first = initialConfig("https://luma.com/build-night");
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value: first,
      onChange: () => undefined,
      onLaunchReadinessChange: (next) => { readiness = next; },
    })));
    await act(async () => vi.advanceTimersByTimeAsync(451));

    const second = { ...first, seedValue: "https://metr.org/about" };
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value: second,
      onChange: () => undefined,
      onLaunchReadinessChange: (next) => { readiness = next; },
    })));
    await act(async () => vi.advanceTimersByTimeAsync(451));
    await act(async () => resolveMetr(previewResponse({
      canonicalUrl: "https://metr.org/about",
      provider: "generic",
      kind: "organization",
      title: "METR evidence",
    })));

    expect(container.textContent).toContain("Generic");
    expect(container.textContent).toContain("METR evidence");
    expect(container.textContent).toContain("Public-only source");
    expect(container.querySelector("#snowball-participant-access")).toBeNull();
    expect(readiness).toMatchObject({ ready: true, sourceValue: "https://metr.org/about" });

    await act(async () => resolveLuma(previewResponse({
      canonicalUrl: "https://luma.com/build-night",
      provider: "luma",
      kind: "event",
      title: "Old Luma evidence",
    })));
    expect(container.textContent).toContain("Generic");
    expect(container.textContent).toContain("METR evidence");
    expect(container.textContent).not.toContain("Old Luma evidence");
    expect(container.querySelector("#snowball-participant-access")).toBeNull();
    expect(readiness).toMatchObject({ ready: true, sourceValue: "https://metr.org/about" });
  });

  it("selects an existing running session and rejects a missing saved session", async () => {
    vi.useFakeTimers();
    let latest = initialConfig();
    latest.participantAccess = { enabled: true, browserSessionName: "missing-session" };
    let readiness: { ready: boolean; reason: string } | undefined;

    function Harness() {
      const [value, setValue] = useState(latest);
      latest = value;
      return createElement(NetworkSnowballEventFields, {
        value,
        onChange: setValue,
        onLaunchReadinessChange: (next) => { readiness = next; },
      });
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => vi.advanceTimersByTimeAsync(451));
    expect(container.textContent).toContain("previously selected session is no longer running");
    expect(readiness).toMatchObject({ ready: false, reason: "session_missing" });

    const checkbox = container.querySelector("#snowball-participant-access") as HTMLButtonElement;
    const trigger = container.querySelector("#snowball-event-session") as HTMLButtonElement;
    await act(async () => trigger.click());
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (candidate) => candidate.textContent?.includes("personal-browser"),
    ) as HTMLElement | undefined;
    expect(option).toBeTruthy();
    await act(async () => option!.click());
    expect(latest.participantAccess).toEqual({
      enabled: false,
      browserSessionName: "personal-browser",
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).not.toContain("Existing browser session");
    expect(readiness).toMatchObject({ ready: true, reason: "ready" });

    await act(async () => checkbox.click());
    await act(async () => Promise.resolve());
    expect(latest.participantAccess).toEqual({
      enabled: true,
      browserSessionName: "personal-browser",
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(readiness).toMatchObject({ ready: true, reason: "ready" });
  });

  it("disables both authorization and session editing with the parent form", async () => {
    const value = initialConfig();
    value.participantAccess.enabled = true;
    await act(async () =>
      root.render(
        createElement(NetworkSnowballEventFields, {
          value,
          onChange: () => undefined,
          disabled: true,
        }),
      ),
    );

    const checkbox = container.querySelector("#snowball-participant-access") as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    await act(async () => Promise.resolve());
    expect((container.querySelector("#snowball-event-session") as HTMLButtonElement).disabled).toBe(true);
  });
});
