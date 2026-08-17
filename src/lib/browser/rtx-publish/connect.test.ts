import { describe, expect, it, vi } from "vitest";
import type { Browser, Page } from "playwright";

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

import { chromium } from "playwright";
import {
  connectToXContentPage,
  findLoggedInXContentPage,
  listXContentPages,
} from "@/lib/browser/rtx-publish/connect";

function mockPage({
  url,
  loggedIn,
}: {
  url: string;
  loggedIn: boolean;
}): Page {
  const page = {
    url: () => url,
    bringToFront: vi.fn(async () => {}),
    evaluate: vi.fn(async () => loggedIn),
    locator: vi.fn((selector: string) => ({
      count: vi.fn(async () => {
        if (!loggedIn) return 0;
        if (selector.includes("loginButton")) return 0;
        if (
          selector.includes("SideNav_NewTweet_Button") ||
          selector.includes("primaryColumn")
        ) {
          return 1;
        }
        return 0;
      }),
      first: vi.fn(function (this: unknown) {
        return page.locator(selector);
      }),
      isVisible: vi.fn(async () => false),
      getAttribute: vi.fn(async () => null),
    })),
  };
  return page as unknown as Page;
}

function mockBrowser(pages: Array<{ url: string; loggedIn: boolean }>): Browser {
  const pageObjects = pages.map((entry) => mockPage(entry));
  return {
    contexts: () => [{ pages: () => pageObjects }],
    close: vi.fn(async () => {}),
  } as unknown as Browser;
}

describe("connect CDP page selection", () => {
  it("prefers a logged-in tab over a higher-scored logged-out home tab", async () => {
    const browser = mockBrowser([
      { url: "https://x.com/home", loggedIn: false },
      { url: "https://x.com/explore", loggedIn: true },
    ]);

    expect(listXContentPages(browser).map((page) => page.url())).toEqual([
      "https://x.com/home",
      "https://x.com/explore",
    ]);

    const page = await findLoggedInXContentPage(browser);
    expect(page?.url()).toBe("https://x.com/explore");
  });
});

describe("connectToXContentPage", () => {
  it("attaches to a logged-in BrowserView target from /json/list", async () => {
    const loggedInPage = mockPage({ url: "https://x.com/home", loggedIn: true });
    const loggedInBrowser = {
      contexts: () => [{ pages: () => [loggedInPage] }],
      close: vi.fn(async () => {}),
    } as unknown as Browser;

    const shellBrowser = {
      contexts: () => [{ pages: () => [] }],
      close: vi.fn(async () => {}),
    } as unknown as Browser;

    vi.mocked(chromium.connectOverCDP).mockImplementation(async (endpoint) => {
      if (String(endpoint).includes("/devtools/page/logged-in")) {
        return loggedInBrowser;
      }
      return shellBrowser;
    });

    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.endsWith("/json/list")) {
        throw new Error(`unexpected fetch ${url}`);
      }
      return new Response(
        JSON.stringify([
          {
            id: "shell",
            type: "page",
            url: "file:///cli-browser/index.html",
            webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/page/shell",
          },
          {
            id: "logged-in",
            type: "page",
            url: "https://x.com/home",
            webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/page/logged-in",
          },
        ]),
        { status: 200 }
      );
    };

    const result = await connectToXContentPage(9444, { fetchImpl });
    expect(result.page.url()).toBe("https://x.com/home");
    expect(chromium.connectOverCDP).toHaveBeenCalledWith(
      "ws://127.0.0.1:9444/devtools/page/logged-in"
    );
  });
});
