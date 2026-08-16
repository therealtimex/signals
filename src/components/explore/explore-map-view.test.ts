// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreContactDrawer } from "@/components/explore/explore-contact-drawer";
import { ExploreMapView } from "@/components/explore/explore-map-view";
import { formatExploreMapBadge } from "@/components/explore/explore-map-utils";
import { AppSidebar } from "@/components/app-sidebar";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/explore",
}));

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => createElement("img", { alt: props.alt }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("@/components/ui/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => createElement("aside", null, children),
  SidebarHeader: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  SidebarContent: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => createElement("ul", null, children),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => createElement("li", null, children),
  SidebarMenuButton: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? children : createElement("button", null, children)),
  SidebarFooter: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));

const exploreFixture: ContactExploreCard = {
  contact: {
    id: "contact-1",
    name: "Drawer Contact",
    headline: null,
    avatarUrl: null,
    location: null,
  },
  persona: {
    visibility: "shared",
    archetype: null,
    tone: null,
    summary: "Drawer summary",
    interests: [],
    confidence: null,
    generatedAt: null,
    stale: false,
    conversionTriggers: [],
    engagementFormats: [],
  },
  identities: [],
  niches: [],
  relationship: null,
  org: null,
  recentPosts: [],
};

describe("formatExploreMapBadge", () => {
  it("renders truncated and untruncated variants", () => {
    expect(
      formatExploreMapBadge({
        totalContacts: 12,
        shownContacts: 12,
        truncated: false,
        nodes: [{ kind: "niche" }, { kind: "niche" }, { kind: "contact" }],
      }),
    ).toBe("12 people · 2 niches");

    expect(
      formatExploreMapBadge({
        totalContacts: 40,
        shownContacts: 20,
        truncated: true,
        nodes: [{ kind: "niche" }],
      }),
    ).toBe("Showing 20 of 40 people · 1 niches");
  });
});

describe("AppSidebar explore entry", () => {
  it("includes Explore nav link", () => {
    const html = renderToStaticMarkup(createElement(AppSidebar));
    expect(html).toContain("Explore");
    expect(html).toContain("/dashboard/explore");
  });
});

vi.mock("@/components/explore/explore-map-force-graph", () => ({
  ExploreMapCanvas: () => createElement("div", { "data-testid": "explore-map-canvas" }),
}));

describe("ExploreMapView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders no-owner empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [],
          edges: [],
          meta: {
            ownerContactId: null,
            totalContacts: 0,
            shownContacts: 0,
            truncated: false,
            limit: 200,
          },
        }),
      }),
    );

    await act(async () => {
      root.render(createElement(ExploreMapView));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Mark your own contact to see your audience");
  });

  it("renders no-audience empty state even when owner has niches in the payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          nodes: [
            {
              id: "contact:owner",
              kind: "contact",
              entityId: "owner",
              label: "Owner",
              avatarUrl: null,
              isOwner: true,
              followersCount: null,
              nicheIds: ["niche-1"],
            },
            {
              id: "niche:niche-1",
              kind: "niche",
              entityId: "niche-1",
              label: "Builders",
              nicheType: "interest",
              memberCount: 1,
            },
          ],
          edges: [],
          meta: {
            ownerContactId: "owner",
            totalContacts: 0,
            shownContacts: 0,
            truncated: false,
            limit: 200,
          },
        }),
      }),
    );

    await act(async () => {
      root.render(createElement(ExploreMapView));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("No audience connections synced yet");
    expect(container.querySelector('[data-testid="explore-map-canvas"]')).toBeNull();
  });
});

describe("ExploreContactDrawer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("renders contact page fallback anchor on fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      }),
    );

    await act(async () => {
      root.render(
        createElement(ExploreContactDrawer, {
          contactId: "contact-1",
          open: true,
          onOpenChange: () => {},
        }),
      );
    });
    await flushEffects();

    const link = document.body.querySelector('a[href="/dashboard/contacts/contact-1"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Open contact page");
  });

  it("renders ContactExploreCardView output when explore fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => exploreFixture,
      }),
    );

    await act(async () => {
      root.render(
        createElement(ExploreContactDrawer, {
          contactId: "contact-1",
          open: true,
          onOpenChange: () => {},
        }),
      );
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Drawer summary");
  });
});
