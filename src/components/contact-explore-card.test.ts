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

const baseContact = {
  id: "contact-1",
  name: "Test Contact",
  headline: null,
  avatarUrl: null,
  location: null,
};

const baseSharedPersona = {
  visibility: "shared" as const,
  archetype: "Builder",
  tone: "Direct",
  summary: "Visible summary",
  interests: ["AI"],
  confidence: 0.8,
  generatedAt: 1_700_000_000,
  stale: false,
  conversionTriggers: [] as string[],
  engagementFormats: [] as string[],
};

const absentExplore: ContactExploreCard = {
  contact: baseContact,
  persona: {
    visibility: "absent",
    archetype: null,
    tone: null,
    summary: null,
    interests: [],
    confidence: null,
    generatedAt: null,
    stale: null,
    conversionTriggers: [],
    engagementFormats: [],
  },
  identities: [],
  niches: [],
  relationship: null,
  org: null,
  recentPosts: [],
};

function sharedExplore(summary: string, stale = false): ContactExploreCard {
  return {
    contact: baseContact,
    persona: { ...baseSharedPersona, summary, stale },
    identities: [],
    niches: [],
    relationship: null,
    org: null,
    recentPosts: [],
  };
}

describe("ContactExploreCardView", () => {
  it("renders shared persona summary and niche chips", () => {
    const explore: ContactExploreCard = {
      contact: baseContact,
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
      relationship: null,
      org: null,
      recentPosts: [],
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

  it("formatPlatformHandle adds the X sigil and leaves other platforms alone", () => {
    expect(formatPlatformHandle("x", "username")).toBe("@username");
    expect(formatPlatformHandle("linkedin", "/in/name")).toBe("/in/name");
  });

  it("renders header, relationship chip, org badge, and recent posts", () => {
    const explore: ContactExploreCard = {
      contact: {
        id: "contact-1",
        name: "Ada Lovelace",
        headline: "Builder",
        avatarUrl: "https://example.com/ada.jpg",
        location: "London",
      },
      persona: {
        ...baseSharedPersona,
        conversionTriggers: ["case studies"],
        engagementFormats: ["threads"],
      },
      identities: [
        {
          id: "id-1",
          platform: "x",
          platformHandle: "@ada",
          displayName: "Ada Lovelace",
          followersCount: 1200,
          followingCount: 100,
          postsCount: 50,
          listedCount: 10,
          engagementRate: 0.05,
          statsUpdatedAt: null,
          metricSnapshotAt: null,
          avatarUrl: "https://example.com/ada.jpg",
          bio: "Math and machines",
          location: "London",
          isVerified: true,
          platformCreatedAt: 1_600_000_000,
          platformUrl: "https://x.com/ada",
          isPrimary: true,
          createdAt: 1_600_000_000,
        },
      ],
      niches: [],
      relationship: { label: "Follower", edgeType: "follows" },
      org: {
        id: "org-1",
        name: "Analytical Engines",
        domain: "engines.example",
        avatarUrl: null,
      },
      recentPosts: [
        {
          id: "post-1",
          contentType: "post",
          platform: "x",
          text: "Hello world",
          url: "https://example.com/post",
          publishedAt: 1_700_000_000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, { contactId: "contact-1", explore }),
    );
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Verified");
    expect(html).toContain("Follower");
    expect(html).toContain("Analytical Engines");
    expect(html).toContain("/dashboard/organizations/org-1");
    expect(html).toContain("What converts them");
    expect(html).toContain("case studies");
    expect(html).toContain("Hello world");
    expect(html).toContain("View post");
    expect(html).toContain("href=\"https://x.com/ada\"");
    expect(html).toContain("1,200 followers");
    expect(html).not.toContain("Followers:");
  });

  it("hides the duplicate profile and empty audience sections on the contact page", () => {
    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, {
        contactId: "contact-1",
        explore: {
          ...absentExplore,
          org: {
            id: "org-rtx",
            name: "RealTimeX.ai",
            domain: "realtimex.ai",
            avatarUrl: null,
          },
          identities: [
            {
              id: "fb-1",
              platform: "facebook",
              platformHandle: "ledangtrung",
              displayName: null,
              followersCount: null,
              followingCount: null,
              postsCount: null,
              listedCount: null,
              engagementRate: null,
              statsUpdatedAt: null,
              metricSnapshotAt: null,
              avatarUrl: "https://broken.example/fb.png",
              bio: null,
              location: null,
              isVerified: false,
              platformCreatedAt: null,
              platformUrl: null,
              isPrimary: false,
              createdAt: 1,
            },
          ],
        },
        showIdentityHeader: false,
      }),
    );
    expect(html).not.toContain("Audience profile");
    expect(html).not.toContain("@ RealTimeX.ai");
    expect(html).not.toContain("No shared niche memberships yet");
    expect(html).not.toContain("No synced posts yet");
    expect(html).not.toContain("Followers:");
    expect(html).toContain("Facebook");
    expect(html).toContain("ledangtrung");
  });

  it("does not repeat interest names as a separate niches card", () => {
    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, {
        contactId: "contact-1",
        explore: {
          ...sharedExplore("Visible summary"),
          niches: [
            {
              id: "niche-1",
              name: "AI",
              slug: "ai",
              nicheType: "interest",
              weight: 0.85,
            },
          ],
        },
        showIdentityHeader: false,
      }),
    );
    expect(html).toContain("AI");
    expect(html).not.toContain("Niches");
    expect(html).not.toContain("85%");
  });

  it("shows local-only badge without generate affordance", () => {
    const explore: ContactExploreCard = {
      contact: baseContact,
      persona: {
        visibility: "local_only",
        archetype: null,
        tone: null,
        summary: null,
        interests: [],
        confidence: null,
        generatedAt: null,
        stale: null,
        conversionTriggers: [],
        engagementFormats: [],
      },
      identities: [],
      niches: [],
      relationship: null,
      org: null,
      recentPosts: [],
    };

    const html = renderToStaticMarkup(
      createElement(ContactExploreCardView, { contactId: "contact-1", explore }),
    );
    expect(html).toContain("Private persona");
    expect(html).toContain("Re-scope it before generating a shared one");
    expect(html).not.toContain("Generate persona");
    expect(html).not.toContain("case studies");
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
          conversionTriggers: [],
          engagementFormats: [],
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
