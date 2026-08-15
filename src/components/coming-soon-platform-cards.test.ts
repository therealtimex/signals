import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComingSoonPlatformCards } from "@/components/coming-soon-platform-cards";
import { PlatformConnectionCard } from "@/components/platform-connection-card";
import {
  getPlatformsWithoutOAuth,
  PLATFORM_DISPLAY_NAMES,
} from "@/lib/platforms/capabilities";

describe("ComingSoonPlatformCards", () => {
  it("renders exactly the oauth:false mapped platforms with coming-soon UI", () => {
    const platforms = getPlatformsWithoutOAuth();
    const html = renderToStaticMarkup(createElement(ComingSoonPlatformCards));

    expect(platforms.sort()).toEqual(["facebook", "instagram", "threads"]);

    for (const platform of platforms) {
      expect(html).toContain(PLATFORM_DISPLAY_NAMES[platform]!);
    }

    expect(html.match(/Coming soon/g)?.length).toBe(platforms.length);
    expect(html).toContain("manually or via agents");
    expect(html).not.toContain(">Connect<");
    expect(html).not.toContain(">Reconnect<");
  });
});

describe("PlatformConnectionCard coming_soon render", () => {
  it("shows badge and explanation without connect affordances", () => {
    const html = renderToStaticMarkup(
      createElement(PlatformConnectionCard, {
        platform: "instagram",
        displayName: "Instagram",
        status: "coming_soon",
        onConnect: () => {},
      })
    );

    expect(html).toContain("Coming soon");
    expect(html).toContain("manually or via agents");
    expect(html).not.toContain(">Connect<");
    expect(html).not.toContain(">Reconnect<");
    expect(html).not.toContain(">Disconnect<");
  });
});
