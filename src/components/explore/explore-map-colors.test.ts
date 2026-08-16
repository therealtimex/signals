// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  buildExploreMapGraphData,
} from "@/components/explore/explore-map-canvas";
import {
  buildExploreMapLinkColor,
  readExploreMapThemeColors,
  resolveCssColor,
  withAlpha,
} from "@/components/explore/explore-map-colors";

describe("explore-map-colors", () => {
  it("resolves CSS variables to concrete canvas colors", () => {
    document.documentElement.style.setProperty("--primary", "#3366cc");
    document.documentElement.style.setProperty("--foreground", "#111111");
    document.documentElement.style.setProperty("--muted-foreground", "#666666");

    const primary = resolveCssColor("var(--primary)", document.documentElement);
    const foreground = resolveCssColor("var(--foreground)", document.documentElement);

    expect(primary).not.toContain("var(");
    expect(primary).not.toBe("#000000");
    expect(foreground).not.toContain("var(");
    expect(foreground).toMatch(/^(#|rgb)/i);
  });

  it("applies alpha to oklch theme colors for link styling", () => {
    const oklchForeground = "oklch(0.17 0.02 270)";
    const oklchMuted = "oklch(0.45 0.02 270)";

    const fadedFollow = withAlpha(oklchForeground, 0.25);
    const fadedMutual = withAlpha(oklchForeground, 0.45);
    const fadedNiche = withAlpha(oklchMuted, 0.35);

    expect(fadedFollow).toBe("oklch(0.17 0.02 270 / 0.25)");
    expect(fadedMutual).toBe("oklch(0.17 0.02 270 / 0.45)");
    expect(fadedNiche).toBe("oklch(0.45 0.02 270 / 0.35)");

    const theme = {
      primary: "oklch(0.55 0.18 195)",
      mutedForeground: oklchMuted,
      foreground: oklchForeground,
      chart: ["oklch(0.65 0.15 195)"],
    };

    expect(buildExploreMapLinkColor("follows", false, theme)).toBe(fadedFollow);
    expect(buildExploreMapLinkColor("follows", true, theme)).toBe(fadedMutual);
    expect(buildExploreMapLinkColor("belongs_to_niche", null, theme)).toBe(fadedNiche);
  });

  it("builds graph colors without CSS variable strings", () => {
    document.documentElement.style.setProperty("--primary", "#3366cc");
    document.documentElement.style.setProperty("--foreground", "#111111");
    document.documentElement.style.setProperty("--muted-foreground", "#666666");
    document.documentElement.style.setProperty("--chart-1", "#22aa88");

    const theme = readExploreMapThemeColors(document.documentElement);
    const graph = buildExploreMapGraphData(
      [
        {
          id: "contact:owner",
          kind: "contact",
          entityId: "owner",
          label: "Owner",
          avatarUrl: null,
          isOwner: true,
          followersCount: 50_000,
          nicheIds: [],
        },
        {
          id: "contact:peer",
          kind: "contact",
          entityId: "peer",
          label: "Peer",
          avatarUrl: null,
          isOwner: false,
          followersCount: 50_000,
          nicheIds: [],
        },
        {
          id: "niche:ai",
          kind: "niche",
          entityId: "ai",
          label: "AI",
          nicheType: "interest",
          memberCount: 2,
        },
      ],
      [
        {
          id: "edge-1",
          source: "contact:owner",
          target: "contact:peer",
          kind: "follows",
          mutual: true,
          weight: null,
        },
        {
          id: "edge-2",
          source: "contact:owner",
          target: "niche:ai",
          kind: "belongs_to_niche",
          mutual: null,
          weight: 0.5,
        },
      ],
      theme,
    );

    for (const node of graph.nodes) {
      expect(node.color).not.toContain("var(");
      expect(node.color).not.toContain("color-mix");
    }
    for (const link of graph.links) {
      expect(link.color).not.toContain("var(");
      expect(link.color).not.toContain("color-mix");
      expect(link.color).toMatch(/rgba?\(/i);
    }

    expect(graph.nodes[0]?.color).not.toBe(graph.nodes[1]?.color);
    expect(buildExploreMapLinkColor("follows", true, theme)).toBe(
      withAlpha(theme.foreground, 0.45),
    );
  });
});
