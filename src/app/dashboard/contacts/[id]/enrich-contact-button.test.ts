// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnrichContactButton } from "./enrich-contact-button";

const refresh = vi.fn();
const push = vi.fn();
const router = { refresh, push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const idleState = {
  status: "idle",
  workflowRunId: null,
  lastRunAt: null,
  fieldsUpdated: [],
  unresolvedFields: [],
  identityLinked: false,
  visitedUrls: [],
  blockedUrls: [],
  ambiguous: false,
  serpCandidates: [],
  message: null,
};

describe("EnrichContactButton authenticated-target repair", () => {
  let container: HTMLDivElement;
  let root: Root;
  let postCount: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    postCount = 0;
    refresh.mockReset();
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return new Response(JSON.stringify(idleState), { status: 200 });
        }
        postCount += 1;
        if (postCount === 1) {
          return new Response(
            JSON.stringify({
              error: "LinkedIn is signed out. Open Settings → Platform connections.",
              code: "RESEARCH_TARGET_UNAVAILABLE",
              details: { settingsPath: "/dashboard/settings?tab=platforms" },
            }),
            { status: 409 },
          );
        }
        return new Response(JSON.stringify({ workflowRunId: "run-retry" }), { status: 202 });
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function clickButton() {
    const button = container.querySelector("button");
    if (!button) throw new Error("button missing");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("renders the exact Platform connections repair link and clears it on retry", async () => {
    await act(async () => {
      root.render(
        createElement(EnrichContactButton, {
          contactId: "contact-1",
          needsWebResearch: true,
          profilePipelineTemplateId: null,
        }),
      );
      await Promise.resolve();
    });

    await clickButton();
    expect(container.textContent).toContain("LinkedIn is signed out");
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Open Platform connections");
    expect(link?.getAttribute("href")).toBe("/dashboard/settings?tab=platforms");

    await clickButton();
    expect(container.querySelector("a")).toBeNull();
  });
});
