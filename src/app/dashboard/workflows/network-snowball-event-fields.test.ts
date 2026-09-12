// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NetworkSnowballEventFields } from "@/app/dashboard/workflows/network-snowball-event-fields";
import {
  networkSnowballSignedInAccessDescription,
  networkSnowballSourceHostname,
} from "@/lib/workflows/network-snowball-signed-in-access";
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
  });

  it("uses provider-aware copy without making the consent control provider-specific", () => {
    expect(networkSnowballSourceHostname("luma.com/build-night")).toBe("luma.com");
    expect(networkSnowballSignedInAccessDescription("https://luma.com/build-night")).toBe(
      "When available, include visible guests, attendees, and organizers on luma.com.",
    );
    expect(networkSnowballSignedInAccessDescription("luma.com/build-night")).toBe(
      "Signed-in access for luma.com is not supported yet. Public extraction still runs.",
    );
    expect(networkSnowballSignedInAccessDescription("http://luma.com/build-night")).toBe(
      "Signed-in access for luma.com is not supported yet. Public extraction still runs.",
    );
    expect(networkSnowballSignedInAccessDescription("https://example.com/community/post")).toBe(
      "Signed-in access for example.com is not supported yet. Public extraction still runs.",
    );
    expect(networkSnowballSignedInAccessDescription("https://meetup.com/groups/events/1")).toBe(
      "Signed-in access for meetup.com is not supported yet. Public extraction still runs.",
    );
    expect(networkSnowballSignedInAccessDescription("https://linkedin.com/events/1")).toBe(
      "Signed-in access for linkedin.com is not supported yet. Public extraction still runs.",
    );
    expect(networkSnowballSignedInAccessDescription("not a URL")).toBe(
      "Signed-in access for this source is not supported yet. Public extraction still runs.",
    );
  });

  it("keeps consent off while showing the Signals Publish session that will be used", async () => {
    let latest = initialConfig("https://example.com/event");

    function Harness() {
      const [value, setValue] = useState(latest);
      latest = value;
      return createElement(NetworkSnowballEventFields, { value, onChange: setValue });
    }

    await act(async () => root.render(createElement(Harness)));

    const checkbox = container.querySelector("#snowball-participant-access") as HTMLButtonElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(checkbox.className).toContain("dark:data-[state=checked]:bg-primary");
    expect(container.textContent).toContain("Use signed-in browser access");
    expect(container.textContent).toContain("example.com");
    expect(container.textContent).toContain("Signals Publish");
    expect(container.textContent).toContain("signals-publish");
    expect(container.textContent).toContain("visible identity");
    expect(container.textContent).toContain("re-checks them during traversal");

    await act(async () => checkbox.click());

    expect(latest.participantAccess).toEqual({
      enabled: true,
      browserSessionName: "signals-publish",
    });
  });

  it("makes custom session selection deliberate and offers a one-click reset", async () => {
    let latest = initialConfig();

    function Harness() {
      const [value, setValue] = useState(latest);
      latest = value;
      return createElement(NetworkSnowballEventFields, { value, onChange: setValue });
    }

    await act(async () => root.render(createElement(Harness)));
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
