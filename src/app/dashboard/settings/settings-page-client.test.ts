// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPageClient } from "@/app/dashboard/settings/settings-page-client";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams("tab=agents"),
}));

describe("SettingsPageClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replace.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/health") {
          return new Response(JSON.stringify({ rtx: { mode: "standalone" } }), { status: 200 });
        }
        if (url.startsWith("/api/platforms/")) {
          return new Response(JSON.stringify({ connected: false, targets: [] }), { status: 200 });
        }
        if (url.includes("/browser-session")) {
          return new Response(JSON.stringify({ hasSession: false }), { status: 200 });
        }
        if (url === "/api/settings/persona-generation") {
          return new Response(
            JSON.stringify({
              storedMode: null,
              requestedMode: "structured_workflow",
              effectiveMode: "structured_workflow",
              source: "default",
              embedded: false,
              options: [
                {
                  value: "terminal_agent",
                  available: false,
                  unavailableReason: "standalone",
                },
                { value: "structured_workflow", available: true },
              ],
            }),
            { status: 200 },
          );
        }
        if (url === "/api/rtx/status") {
          return new Response(
            JSON.stringify({
              bootstrap: {
                mode: "standalone",
                permissions: null,
              },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders AI & agents tab content from the URL", async () => {
    await act(async () => {
      root.render(createElement(SettingsPageClient));
    });

    expect(container.textContent).toContain("Persona generation mode");
    expect(container.textContent).toContain("RealTimeX runtime");
    expect(container.textContent).not.toContain("Platform Connections");
  });

  it("uses platform fetch URLs for the platforms tab", async () => {
    await act(async () => {
      root.render(createElement(SettingsPageClient));
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/x/browser-session");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/linkedin");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/linkedin/browser-session");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/facebook");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/facebook/browser-session");
  });
});
