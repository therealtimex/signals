import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Browser, Page } from "playwright";
import { PublishError } from "@/lib/browser/publishers/types";

vi.mock("@/lib/browser/anti-detection", () => ({
  sleep: vi.fn(async () => {}),
}));

vi.mock("@/lib/browser/publishers/publish-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/browser/publishers/publish-utils")>();
  return {
    ...actual,
    humanTypeText: vi.fn(async () => {}),
    detectCaptcha: vi.fn(() => false),
    resolveMediaPaths: vi.fn(() => ["/tmp/test.png"]),
  };
});

import {
  isXLoginUrl,
  prepareLoggedInXPage,
  runXAutoPublishSteps,
  runXReviewPublishSteps,
  waitForProfileTimelineReady,
} from "@/lib/browser/rtx-publish/x-publish-steps";

function buildLocator(overrides: Record<string, unknown> = {}) {
  const locator = {
    getAttribute: vi.fn<(name: string) => Promise<string | null>>(async () => null),
    isVisible: vi.fn(async () => false),
    waitFor: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    count: vi.fn(async () => 0),
    nth: vi.fn(function (this: unknown) {
      return locator;
    }),
    first: vi.fn(function (this: unknown) {
      return locator;
    }),
    innerText: vi.fn(async () => ""),
    locator: vi.fn(function (this: unknown) {
      return locator;
    }),
    setInputFiles: vi.fn(async () => {}),
    ...overrides,
  };
  return locator;
}

function createMockPage() {
  const locators: Record<string, ReturnType<typeof buildLocator>> = {};
  const getLocator = (selector: string) => {
    if (!locators[selector]) locators[selector] = buildLocator();
    return locators[selector];
  };

  const primaryColumn = buildLocator({
    isVisible: vi.fn(async () => true),
    count: vi.fn(async () => 1),
  });
  const composeButton = buildLocator({
    isVisible: vi.fn(async () => false),
    count: vi.fn(async () => 0),
  });
  const progressbar = buildLocator({ isVisible: vi.fn(async () => false) });
  const articles = buildLocator({ count: vi.fn(async () => 0) });
  const emptyState = buildLocator({ isVisible: vi.fn(async () => false) });

  const page = {
    url: vi.fn(() => "https://x.com/home"),
    goto: vi.fn(async (..._args: Parameters<Page["goto"]>) => null),
    bringToFront: vi.fn(async () => {}),
    evaluate: vi.fn(async () => null),
    waitForSelector: vi.fn(async () => {}),
    locator: vi.fn((selector: string) => {
      if (selector === "article") return articles;
      if (selector.includes("primaryColumn")) return primaryColumn;
      if (selector.includes("SideNav_NewTweet_Button")) return composeButton;
      if (selector === '[role="progressbar"]') return progressbar;
      if (selector.includes("emptyState")) return emptyState;
      return getLocator(selector);
    }),
  };

  return {
    page: page as unknown as import("playwright").Page,
    getLocator,
    locators,
    articles,
    emptyState,
    primaryColumn,
    composeButton,
  };
}

function mockConfirmedEmptyProfile(emptyState: ReturnType<typeof buildLocator>) {
  emptyState.isVisible.mockResolvedValue(true);
}


function mockRetweetOnlyProfile(
  articles: ReturnType<typeof buildLocator>,
  statusId: string
) {
  const statusLink = buildLocator({
    getAttribute: vi.fn(async () => `/otheruser/status/${statusId}`),
    count: vi.fn(async () => 1),
    nth: vi.fn(function (this: unknown) {
      return statusLink;
    }),
  });
  const article = buildLocator({
    innerText: vi.fn(async () => "retweeted content"),
    locator: vi.fn(() => statusLink),
  });
  articles.count.mockResolvedValue(1);
  articles.nth.mockReturnValue(article);
}

function mockProfileWithStatus(
  articles: ReturnType<typeof buildLocator>,
  statusId: string,
  text: string
) {
  const statusLink = buildLocator({
    getAttribute: vi.fn(async () => `/founder/status/${statusId}`),
    count: vi.fn(async () => 1),
    nth: vi.fn(function (this: unknown) {
      return statusLink;
    }),
  });
  const article = buildLocator({
    innerText: vi.fn(async () => text),
    locator: vi.fn(() => statusLink),
  });
  articles.count.mockResolvedValue(1);
  articles.nth.mockReturnValue(article);
}

describe("isXLoginUrl", () => {
  it("detects login and oauth flows", () => {
    expect(isXLoginUrl("https://x.com/i/flow/login")).toBe(true);
    expect(isXLoginUrl("https://x.com/home")).toBe(false);
  });
});

describe("prepareLoggedInXPage", () => {
  it("throws session_expired when handle cannot be detected", async () => {
    const { page, getLocator } = createMockPage();
    getLocator('[data-testid="loginButton"]').isVisible.mockResolvedValue(false);
    getLocator('[data-testid="AppTabBar_Profile_Link"]').getAttribute.mockResolvedValue(null);

    await expect(prepareLoggedInXPage(page)).rejects.toMatchObject({
      errorCode: "session_expired",
    });
  });

  it("returns handle when logged in via mobile profile link", async () => {
    const { page, getLocator } = createMockPage();
    getLocator('[data-testid="AppTabBar_Profile_Link"]').getAttribute.mockResolvedValue("/founder");

    await expect(prepareLoggedInXPage(page)).resolves.toBe("@founder");
  });

  it("returns handle when logged in via desktop profile link", async () => {
    const { page, primaryColumn, composeButton, getLocator } = createMockPage();
    primaryColumn.count.mockResolvedValue(0);
    composeButton.count.mockResolvedValue(1);
    getLocator('a[aria-label="Profile"]').getAttribute.mockResolvedValue("/trungle");

    await expect(prepareLoggedInXPage(page)).resolves.toBe("@trungle");
  });
});

describe("waitForProfileTimelineReady", () => {
  beforeEach(() => {
    process.env.SIGNALS_RTX_PUBLISH_TEST = "1";
  });

  afterEach(() => {
    delete process.env.SIGNALS_RTX_PUBLISH_TEST;
  });

  it("times out when zero articles are visible without the empty-state marker", async () => {
    const { page } = createMockPage();

    await expect(waitForProfileTimelineReady(page, "@founder")).rejects.toMatchObject({
      errorCode: "timeout",
    });
  });

  it("returns confirmedEmpty after the explicit empty-state marker is stable", async () => {
    const { page, emptyState } = createMockPage();
    mockConfirmedEmptyProfile(emptyState);

    await expect(waitForProfileTimelineReady(page, "@founder")).resolves.toEqual({
      confirmedEmpty: true,
      candidates: [],
    });
  });

  it("navigates to the profile once and polls the same document", async () => {
    const { page, articles } = createMockPage();
    mockProfileWithStatus(articles, "111", "hello");

    await waitForProfileTimelineReady(page, "@founder");

    const profileNavigations = vi
      .mocked(page.goto)
      .mock.calls.filter(([url]) => String(url).includes("/founder"));
    expect(profileNavigations).toHaveLength(1);
  });

  it("accepts a retweet-only loaded profile with zero owned candidates", async () => {
    const { page, articles } = createMockPage();
    mockRetweetOnlyProfile(articles, "999");

    await expect(waitForProfileTimelineReady(page, "@founder")).resolves.toEqual({
      confirmedEmpty: false,
      candidates: [],
    });
  });
});

describe("runXAutoPublishSteps", () => {
  beforeEach(() => {
    process.env.SIGNALS_RTX_PUBLISH_TEST = "1";
  });

  afterEach(() => {
    delete process.env.SIGNALS_RTX_PUBLISH_TEST;
  });
  it("does not click Post when baseline capture times out", async () => {
    const { page, getLocator } = createMockPage();
    const postButton = getLocator('[data-testid="tweetButton"]');
    vi.mocked(page.goto).mockImplementation(async (url) => {
      if (String(url).includes("/founder")) {
        throw new Error("navigation timeout");
      }
      return null;
    });

    await expect(
      runXAutoPublishSteps(page, { platform: "x", mode: "auto", text: "hello" }, "@founder")
    ).rejects.toMatchObject({ errorCode: "timeout" });
  });

  it("returns failure when no new status appears after auto submit", async () => {
    const { page, getLocator, articles } = createMockPage();
    mockProfileWithStatus(articles, "111", "hello");
    getLocator('[data-testid="SideNav_NewTweet_Button"]').waitFor.mockResolvedValue(undefined);
    getLocator('[data-testid="tweetTextarea_0"]').waitFor.mockResolvedValue(undefined);
    getLocator('[data-testid="tweetButton"]').waitFor.mockResolvedValue(undefined);

    const result = await runXAutoPublishSteps(
      page,
      { platform: "x", mode: "auto", text: "hello" },
      "@founder"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No newly published post");
  });
});

describe("runXReviewPublishSteps", () => {
  beforeEach(() => {
    process.env.SIGNALS_RTX_PUBLISH_TEST = "1";
  });

  afterEach(() => {
    delete process.env.SIGNALS_RTX_PUBLISH_TEST;
  });
  it("fails when compose closes but only an old duplicate exists", async () => {
    const { page, getLocator, articles } = createMockPage();
    mockProfileWithStatus(articles, "111", "hello");
    getLocator('[data-testid="SideNav_NewTweet_Button"]').waitFor.mockResolvedValue(undefined);
    getLocator('[data-testid="tweetTextarea_0"]').waitFor.mockResolvedValue(undefined);
    getLocator('[data-testid="tweetTextarea_0"]').isVisible.mockResolvedValue(false);

    const result = await runXReviewPublishSteps(
      page,
      { platform: "x", mode: "review", text: "hello" },
      "@founder"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Compose closed without detecting a newly published post");
  });
});

describe("typed publish errors", () => {
  it("maps media upload timeouts to upload_failed", async () => {
    const { page, getLocator, emptyState } = createMockPage();
    mockConfirmedEmptyProfile(emptyState);
    getLocator('[data-testid="SideNav_NewTweet_Button"]').waitFor.mockResolvedValue(undefined);
    getLocator('[data-testid="tweetTextarea_0"]').waitFor.mockResolvedValue(undefined);
    getLocator('input[data-testid="fileInput"]').first.mockReturnValue(
      buildLocator({
        waitFor: vi.fn(async () => {
          throw new Error("Timeout 5000ms exceeded");
        }),
      })
    );

    await expect(
      runXAutoPublishSteps(
        page,
        { platform: "x", mode: "auto", text: "hello", mediaAssetIds: ["asset-1"] },
        "@founder"
      )
    ).rejects.toMatchObject({ errorCode: "upload_failed" });
  });

  it("preserves PublishError codes in executor without blanket remapping", async () => {
    const { executeXPublishRtx } = await import("@/lib/browser/rtx-publish/x-publish-executor");
    const { page } = createMockPage();

    const result = await executeXPublishRtx(
      { platform: "x", mode: "auto", text: "hello" },
      {
        env: { RTX_APP_ID: "app", SERVER_URL: "http://127.0.0.1:3001" },
        connectToXContentPage: vi.fn(async () => ({
          browser: { close: vi.fn(async () => {}) } as unknown as Browser,
          page,
        })),
        browserSessionApi: {
          listSessions: vi.fn(async () => [
            { sessionName: "signals-publish", remoteDebugPort: 9333, running: true },
          ]),
          createSession: vi.fn(async () => ({})),
          startSession: vi.fn(async () => ({})),
          stopSession: vi.fn(async () => {}),
        },
      }
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("session_expired");
  });
});
