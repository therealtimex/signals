// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContactExploreCardView,
  formatPlatformHandle,
  formatRelativeGeneratedAt,
} from "@/components/contact-explore-card";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";

const baseSharedPersona = {
  visibility: "shared" as const,
  archetype: "Builder",
  tone: "Direct",
  summary: "Visible summary",
  interests: ["AI"],
  confidence: 0.8,
  generatedAt: 1_700_000_000,
};

const absentExplore: ContactExploreCard = {
  persona: {
    visibility: "absent",
    archetype: null,
    tone: null,
    summary: null,
    interests: [],
    confidence: null,
    generatedAt: null,
    stale: null,
  },
  identities: [],
  niches: [],
};

function sharedExplore(summary: string, stale = false): ContactExploreCard {
  return {
    persona: { ...baseSharedPersona, summary, stale },
    identities: [],
    niches: [],
  };
}

describe("ContactExploreCardView", () => {
  it("renders shared persona summary and niche chips", () => {
    const explore: ContactExploreCard = {
      persona: { ...baseSharedPersona, stale: false },
      identities: [],
      niches: [
        {
          id: "niche-1",
          name: "AI Builders",
          slug: "ai-builders",
          nicheType: "interest",
          weight: 0.9,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, { contactId: "contact-1", explore }),
    );
    expect(html).toContain("Visible summary");
    expect(html).toContain("AI Builders");
    expect(html).toContain("Regenerate");
    expect(html).not.toContain("Private persona");
  });

  it("renders absent state with generate affordance", () => {
    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, { contactId: "contact-1", explore: absentExplore }),
    );
    expect(html).toContain("No shared persona yet");
    expect(html).toContain("Generate persona");
  });

  it("renders stale shared persona with refresh affordance", () => {
    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, {
        contactId: "contact-1",
        explore: sharedExplore("Visible summary", true),
      }),
    );
    expect(html).toContain("Stale");
    expect(html).toContain("Refresh persona");
    expect(html).not.toContain("Regenerate");
  });

  it("formatPlatformHandle returns stored value unchanged", () => {
    expect(formatPlatformHandle("@username")).toBe("@username");
    expect(formatPlatformHandle("/in/name")).toBe("/in/name");
  });

  it("shows local-only badge without generate affordance", () => {
    const explore: ContactExploreCard = {
      persona: {
        visibility: "local_only",
        archetype: null,
        tone: null,
        summary: null,
        interests: [],
        confidence: null,
        generatedAt: null,
        stale: null,
      },
      identities: [],
      niches: [],
    };

    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, { contactId: "contact-1", explore }),
    );
    expect(html).toContain("Private persona");
    expect(html).toContain("Re-scope it before generating a shared one");
    expect(html).not.toContain("Generate persona");
  });

  it("formatRelativeGeneratedAt stays relative beyond seven days", () => {
    const now = 2_000_000_000;
    expect(formatRelativeGeneratedAt(now - 30, now)).toBe("just now");
    expect(formatRelativeGeneratedAt(now - 120, now)).toBe("2m ago");
    expect(formatRelativeGeneratedAt(now - 86_400 * 10, now)).toBe("10d ago");
    expect(formatRelativeGeneratedAt(now - 86_400 * 14, now)).toBe("2w ago");
    expect(formatRelativeGeneratedAt(now - 86_400 * 60, now)).toBe("2mo ago");
    expect(formatRelativeGeneratedAt(now - 86_400 * 400, now)).toBe("1y ago");
  });
});

describe("ContactExploreCardView interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let actWarnings: string[];

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    actWarnings = [];
    vi.spyOn(console, "error").mockImplementation((message) => {
      if (typeof message === "string" && message.includes("act(...)")) {
        actWarnings.push(message);
      }
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    expect(actWarnings).toEqual([]);
    vi.restoreAllMocks();
  });

  async function renderCard(props: { contactId: string; explore: ContactExploreCard }) {
    await act(async () => {
      root.render(createElement(ContactExploreCardView, props));
    });
  }

  function buttonByText(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes(text),
    );
    if (!button) {
      throw new Error(`Button not found: ${text}`);
    }
    return button;
  }

  it("generates persona, swaps projection, and sends force:false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generated: true,
        persona: {
          ...absentExplore.persona,
          visibility: "shared",
          summary: "Generated summary",
          stale: false,
          generatedAt: 1_800_000_000,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({ contactId: "contact-1", explore: absentExplore });
    await act(async () => {
      buttonByText("Generate persona").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/contact-1/generate-persona",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ force: false }),
      }),
    );
    expect(container.textContent).toContain("Generated summary");
    vi.unstubAllGlobals();
  });

  it("regenerates with force:true and shows API errors inline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Insufficient evidence for persona generation" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          generated: true,
          persona: {
            ...baseSharedPersona,
            summary: "Regenerated summary",
            stale: false,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({
      contactId: "contact-1",
      explore: sharedExplore("Visible summary", false),
    });

    await act(async () => {
      buttonByText("Regenerate").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ force: true }),
    });
    expect(container.textContent).toContain("Insufficient evidence for persona generation");

    await act(async () => {
      buttonByText("Regenerate").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Regenerated summary");
    vi.unstubAllGlobals();
  });

  it("refreshes stale persona with force:false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generated: true,
        persona: {
          ...baseSharedPersona,
          summary: "Refreshed summary",
          stale: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({
      contactId: "contact-1",
      explore: sharedExplore("Stale summary", true),
    });
    await act(async () => {
      buttonByText("Refresh persona").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/contacts/contact-1/generate-persona",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ force: false }),
      }),
    );
    expect(container.textContent).toContain("Refreshed summary");
    expect(container.textContent).not.toContain("Stale summary");
    vi.unstubAllGlobals();
  });

  it("disables the button while generation is in flight", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({ contactId: "contact-1", explore: absentExplore });

    await act(async () => {
      buttonByText("Generate persona").click();
    });

    const button = buttonByText("Generate persona");
    expect(button.disabled).toBe(true);
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    await act(async () => {
      resolveFetch?.({
        ok: true,
        json: async () => ({
          generated: true,
          persona: {
            ...baseSharedPersona,
            summary: "Done",
            stale: false,
          },
        }),
      });
      await Promise.resolve();
    });

    expect(buttonByText("Regenerate").disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("resets optimistic state when contactId or server projection changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generated: true,
        persona: {
          ...baseSharedPersona,
          summary: "Optimistic summary",
          stale: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({ contactId: "contact-1", explore: absentExplore });
    await act(async () => {
      buttonByText("Generate persona").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Optimistic summary");

    await renderCard({
      contactId: "contact-2",
      explore: sharedExplore("Server summary for contact 2", false),
    });

    expect(container.textContent).toContain("Server summary for contact 2");
    expect(container.textContent).not.toContain("Optimistic summary");
    vi.unstubAllGlobals();
  });

  it("ignores stale in-flight responses after contact rerender", async () => {
    let resolveA: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("contact-a")) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          generated: true,
          persona: {
            ...baseSharedPersona,
            summary: "Contact B summary",
            stale: false,
          },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({ contactId: "contact-a", explore: absentExplore });
    await act(async () => {
      buttonByText("Generate persona").click();
    });

    await renderCard({
      contactId: "contact-b",
      explore: sharedExplore("Server summary for contact B", false),
    });
    expect(container.textContent).toContain("Server summary for contact B");
    expect(container.textContent).not.toContain("Contact A summary");

    await act(async () => {
      buttonByText("Regenerate").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Contact B summary");

    await act(async () => {
      resolveA?.({
        ok: true,
        json: async () => ({
          generated: true,
          persona: {
            ...baseSharedPersona,
            summary: "Contact A summary",
            stale: false,
          },
        }),
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Contact B summary");
    expect(container.textContent).not.toContain("Contact A summary");
    vi.unstubAllGlobals();
  });

  it("ignores stale JSON completion after contact rerender", async () => {
    let resolveJson: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveJson = resolve;
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderCard({ contactId: "contact-a", explore: absentExplore });
    await act(async () => {
      buttonByText("Generate persona").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    await renderCard({
      contactId: "contact-b",
      explore: sharedExplore("Server summary for contact B", false),
    });
    expect(container.textContent).toContain("Server summary for contact B");
    expect(container.textContent).not.toContain("Contact A summary");

    await act(async () => {
      resolveJson?.({
        generated: true,
        persona: {
          ...baseSharedPersona,
          summary: "Contact A summary",
          stale: false,
        },
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Server summary for contact B");
    expect(container.textContent).not.toContain("Contact A summary");
    vi.unstubAllGlobals();
  });
});
