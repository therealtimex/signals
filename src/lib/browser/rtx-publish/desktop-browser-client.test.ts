import { describe, expect, it } from "vitest";
import {
  parseBrowserTabRecord,
  parseXContentTabsFromSession,
} from "@/lib/browser/rtx-publish/desktop-browser-client";

describe("desktop-browser-client parsers", () => {
  it("parses X tabs from session payload", () => {
    const tabs = parseXContentTabsFromSession({
      tabs: [
        {
          id: 2,
          ref: "cli-browser:9444:tab:2",
          url: "https://x.com/home",
          title: "Home / X",
          isActive: true,
        },
        {
          id: 1,
          ref: "cli-browser:9444:tab:1",
          url: "file:///cli-browser/start.html",
          title: "Start",
        },
      ],
    });

    expect(tabs).toEqual([
      {
        id: 2,
        ref: "cli-browser:9444:tab:2",
        url: "https://x.com/home",
        title: "Home / X",
        isActive: true,
      },
    ]);
  });

  it("parses individual tab records", () => {
    expect(
      parseBrowserTabRecord({
        id: 3,
        ref: "cli-browser:9555:tab:3",
        url: "https://x.com/explore",
        title: "Explore / X",
      })
    ).toMatchObject({ id: 3, url: "https://x.com/explore" });
  });
});
