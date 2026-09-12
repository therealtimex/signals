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

function findButton(label: string, root: ParentNode = document.body): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  return button!;
}

describe("NetworkSnowballEventFields", () => {
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

    await act(async () => checkbox.click());

    expect(latest.participantAccess).toEqual({
      enabled: true,
      browserSessionName: "signals-publish",
    });
    expect(container.textContent).toContain("Signals Publish");
    expect(container.textContent).toContain("identity and source access at launch");
  });

  it("makes generic organization links public-only and hides event controls", async () => {
    const value = initialConfig("https://metr.org/about");
    await act(async () => root.render(createElement(NetworkSnowballEventFields, {
      value,
      onChange: () => undefined,
    })));
    expect(container.textContent).toContain("Generic");
    expect(container.textContent).toContain("Public-only source");
    expect(container.querySelector("#snowball-participant-access")).toBeNull();
    expect(container.querySelector("#snowball-event-depth")).toBeNull();
    expect(container.querySelector("#snowball-max-events")).toBeNull();
  });

  it("debounces previews and cancels stale source requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
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

  it("makes custom session selection deliberate and offers a one-click reset", async () => {
    let latest = initialConfig();

    function Harness() {
      const [value, setValue] = useState(latest);
      latest = value;
      return createElement(NetworkSnowballEventFields, { value, onChange: setValue });
    }

    await act(async () => root.render(createElement(Harness)));
    const checkbox = container.querySelector("#snowball-participant-access") as HTMLButtonElement;
    await act(async () => checkbox.click());
    await act(async () => findButton("Change", container).click());

    const input = container.querySelector("#snowball-event-session") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "personal-browser");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latest.participantAccess.browserSessionName).toBe("personal-browser");

    await act(async () => findButton("Use Signals Publish", container).click());
    expect(latest.participantAccess.browserSessionName).toBe("signals-publish");
    expect(container.querySelector("#snowball-event-session")).toBeNull();
    expect(document.activeElement).toBe(findButton("Change", container));
    expect(container.querySelector("code")?.className).toContain("break-all");
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
    expect(findButton("Change", container).disabled).toBe(true);
  });
});
