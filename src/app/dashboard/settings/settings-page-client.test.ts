// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPageClient } from "@/app/dashboard/settings/settings-page-client";
import { settingsTabHref } from "@/app/dashboard/settings/settings-tabs";

const replace = vi.fn();
let searchParams = new URLSearchParams("tab=agents");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

function stubSettingsFetch() {
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
      if (url === "/api/personality/binding") {
        return new Response(
          JSON.stringify({
            status: {
              workspace: { slug: "signals", dir: "/working-data/signals" },
              binding: null,
              currentSourceHash: null,
              status: "unbound",
              compatibleTargets: [],
              host: { capability: "available", version: 1 },
            },
            history: [],
            proposals: [],
            diagnostics: { orphanProposalIds: [] },
          }),
          { status: 200 },
        );
      }
      if (url === "/api/personality/onboarding") {
        return new Response(
          JSON.stringify({
            success: true,
            workspace: {
              id: "42",
              slug: "signals",
              displayName: "Signals GTM",
              path: "/working-data/signals",
            },
            personality: { present: false, files: [] },
            editor: { state: "available", version: 1, limits: null },
            shouldOnboard: true,
          }),
          { status: 200 },
        );
      }
      if (url === "/api/personality/statements") {
        return new Response(JSON.stringify({ values: [], boundaries: [] }), { status: 200 });
      }
      if (url === "/api/personality/sources" || url === "/api/personality/represented-org") {
        return new Response(JSON.stringify({ error: "Self contact missing" }), { status: 404 });
      }
      if (url === "/api/platform-targets") {
        return new Response(JSON.stringify({ targets: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("SettingsPageClient", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalReplaceState = window.history.replaceState;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    replace.mockReset();
    searchParams = new URLSearchParams("tab=agents");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState = vi.fn();
    stubSettingsFetch();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.history.replaceState = originalReplaceState;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
  });

  async function renderPage() {
    await act(async () => {
      root.render(createElement(SettingsPageClient));
      await Promise.resolve();
    });
  }

  it("renders AI & agents tab content from the URL", async () => {
    await renderPage();

    expect(container.textContent).toContain("Persona generation mode");
    expect(container.textContent).toContain("RealTimeX runtime");
    expect(container.textContent).not.toContain("Platform Connections");
  });

  it("uses platform fetch URLs for the platforms tab", async () => {
    await renderPage();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/x/browser-session");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/linkedin");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/linkedin/browser-session");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/facebook");
    expect(fetchMock).toHaveBeenCalledWith("/api/platforms/facebook/browser-session");
  });

  it("renders platform connections when the platforms tab is selected", async () => {
    searchParams = new URLSearchParams("tab=platforms");
    await renderPage();

    expect(container.textContent).toContain("Platform Connections");
    expect(container.textContent).not.toContain("Persona generation mode");
  });

  it("renders the bound workspace Personality surface from the URL", async () => {
    searchParams = new URLSearchParams("tab=personality");
    await renderPage();

    expect(container.textContent).toContain("Bound RealTimeX workspace");
    expect(container.textContent).toContain("Signals GTM");
    expect(container.textContent).toContain("Proposal review");
    expect(container.textContent).not.toContain("Platform Connections");
  });

  it("cleans OAuth callback params onto the platforms tab", async () => {
    searchParams = new URLSearchParams("connected=x");
    await renderPage();

    expect(window.history.replaceState).toHaveBeenCalledWith({}, "", settingsTabHref("platforms"));
  });
});
