#!/usr/bin/env node
/**
 * Deterministic X publish over CDP (ported from P6a rtx-publish steps).
 *
 * Usage:
 *   node scripts/x-publish.cjs --port <cdpPort> --payload <job.json>
 *
 * Payload: { text, threadTexts?, mediaPaths?, expectedHandle? }
 * mediaPaths: string[] for single post, or string[][] per thread tweet
 *
 * stdout (last line): JSON result
 */
const { readFileSync } = require("node:fs");
const { chromium } = require("playwright-core");

const X_HOME_URL = "https://x.com/home";

const X_SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  loginButton: '[data-testid="loginButton"]',
  composeButton: '[data-testid="SideNav_NewTweet_Button"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  tweetTextarea: (index) => `[data-testid="tweetTextarea_${index}"]`,
  tweetButton: '[data-testid="tweetButton"]',
  addButton: '[data-testid="addButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachments: '[data-testid="attachments"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  desktopProfileLink: 'a[aria-label="Profile"]',
};

const X_LOGGED_IN_MARKERS = [
  X_SELECTORS.primaryColumn,
  X_SELECTORS.composeButton,
  X_SELECTORS.accountSwitcher,
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
];

const TWITTER_EPOCH_MS = 1288834974657;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(result) {
  const line = JSON.stringify(result);
  console.log(line);
  process.exit(result.success ? 0 : 1);
}

function parseArgs(argv) {
  let port = null;
  let payloadPath = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--payload") payloadPath = argv[++i];
  }
  if (!port || !payloadPath) {
    emit({
      success: false,
      error: "Usage: node x-publish.cjs --port <cdpPort> --payload <job.json>",
      errorCode: "unknown",
    });
  }
  return { port, payload: JSON.parse(readFileSync(payloadPath, "utf8")) };
}

function normalizeTweetText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractStatusIdFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

function isStatusOwnedByHandle(href, handle) {
  const clean = handle.replace(/^@/, "").toLowerCase();
  try {
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const match = path.match(/^\/([^/]+)\/status\/(\d+)/);
    return match?.[1]?.toLowerCase() === clean;
  } catch {
    return false;
  }
}

function maxStatusIdNumeric(statusIds) {
  let max = 0n;
  for (const id of statusIds) {
    try {
      const value = BigInt(id);
      if (value > max) max = value;
    } catch {
      // ignore
    }
  }
  return max;
}

function statusIdToTimestampMs(statusId) {
  try {
    return Number(BigInt(statusId) >> 22n) + TWITTER_EPOCH_MS;
  } catch {
    return null;
  }
}

function selectNewOwnedStatus(candidates, handle, expectedText, baseline) {
  const needle = normalizeTweetText(expectedText).slice(0, 80);
  if (!needle) return null;

  for (const candidate of candidates) {
    if (baseline.statusIds.has(candidate.statusId)) continue;
    let candidateId;
    try {
      candidateId = BigInt(candidate.statusId);
    } catch {
      continue;
    }
    if (candidateId <= baseline.maxStatusId) continue;
    if (!isStatusOwnedByHandle(candidate.href, handle)) continue;
    if (!normalizeTweetText(candidate.text).includes(needle)) continue;
    const createdAt = statusIdToTimestampMs(candidate.statusId);
    if (createdAt === null || createdAt < baseline.capturedAtMs) continue;
    return {
      success: true,
      handle,
      platformPostId: candidate.statusId,
      platformUrl: candidate.href.startsWith("http")
        ? candidate.href
        : `https://x.com${candidate.href}`,
    };
  }
  return null;
}

function isXLoginUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/i/flow/login") ||
    lower.includes("/oauth") ||
    lower.includes("/account/access")
  );
}

async function isXLoggedInPage(page) {
  if (isXLoginUrl(page.url())) return false;
  const loginVisible = await page
    .locator(X_SELECTORS.loginButton)
    .first()
    .isVisible()
    .catch(() => false);
  if (loginVisible) return false;
  for (const selector of X_LOGGED_IN_MARKERS) {
    if ((await page.locator(selector).count().catch(() => 0)) > 0) return true;
  }
  return false;
}

async function assertXLoggedIn(page) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isXLoggedInPage(page)) return;
    await sleep(500);
  }
  throw { message: "X is not logged in on RealTimeX Browser.", errorCode: "session_expired" };
}

async function detectXDisplayHandle(page) {
  for (const selector of [X_SELECTORS.profileLink, X_SELECTORS.desktopProfileLink]) {
    const href = await page.locator(selector).first().getAttribute("href").catch(() => null);
    if (href?.startsWith("/") && !href.includes("/status/")) {
      const segment = href.replace(/^\//, "").split("/")[0];
      if (segment && !["home", "explore", "i"].includes(segment.toLowerCase())) {
        return segment.startsWith("@") ? segment : `@${segment}`;
      }
    }
  }
  return null;
}

async function readProfileStatusCandidates(page, handle) {
  const profileHandle = handle.replace(/^@/, "");
  await page.goto(`https://x.com/${profileHandle}`, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  await sleep(1000);

  const articles = page.locator("article");
  const count = await articles.count();
  const ownedCandidates = [];

  for (let i = 0; i < Math.min(count, 12); i++) {
    const article = articles.nth(i);
    const text = normalizeTweetText((await article.innerText().catch(() => "")) || "");
    const links = article.locator('a[href*="/status/"]');
    const linkCount = await links.count();
    for (let j = 0; j < linkCount; j++) {
      const href = await links.nth(j).getAttribute("href").catch(() => null);
      const statusId = extractStatusIdFromHref(href);
      if (!href || !statusId) continue;
      if (isStatusOwnedByHandle(href, handle)) {
        ownedCandidates.push({ statusId, href, text });
        break;
      }
    }
  }
  return ownedCandidates;
}

async function captureProfileStatusBaseline(page, handle) {
  const candidates = await readProfileStatusCandidates(page, handle);
  const statusIds = new Set(candidates.map((c) => c.statusId));
  return {
    statusIds,
    maxStatusId: maxStatusIdNumeric(statusIds),
    capturedAtMs: Date.now(),
  };
}

async function humanType(page, selector, text) {
  await page.click(selector);
  await page.fill(selector, "");
  for (const char of text) {
    await page.keyboard.type(char, { delay: 20 });
  }
}

async function uploadMedia(page, paths) {
  if (!paths?.length) return;
  const fileInput = page.locator(X_SELECTORS.fileInput).first();
  await fileInput.waitFor({ timeout: 5_000 });
  await fileInput.setInputFiles(paths);
  await page.waitForSelector(X_SELECTORS.attachments, { timeout: 30_000 });
  await sleep(1000);
}

async function fillCompose(page, payload) {
  await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(1000);
  await assertXLoggedIn(page);

  await page.locator(X_SELECTORS.composeButton).waitFor({ timeout: 10_000 });
  await page.locator(X_SELECTORS.composeButton).click();
  await sleep(1000);

  const textarea0 = X_SELECTORS.tweetTextarea(0);
  await page.waitForSelector(textarea0, { timeout: 10_000 });
  await humanType(page, textarea0, payload.text);

  const mediaPaths = Array.isArray(payload.mediaPaths?.[0])
    ? payload.mediaPaths[0]
    : payload.mediaPaths;
  if (mediaPaths?.length) {
    await uploadMedia(page, mediaPaths);
  }

  const threadTexts = payload.threadTexts ?? [];
  for (let i = 0; i < threadTexts.length; i++) {
    await page.locator(X_SELECTORS.addButton).click();
    await sleep(800);
    const selector = X_SELECTORS.tweetTextarea(i + 1);
    await page.waitForSelector(selector, { timeout: 5_000 });
    await humanType(page, selector, threadTexts[i]);
    const threadMedia = Array.isArray(payload.mediaPaths?.[i + 1])
      ? payload.mediaPaths[i + 1]
      : undefined;
    if (threadMedia?.length) await uploadMedia(page, threadMedia);
  }
}

async function waitForVerifiedPost(page, expectedText, handle, baseline, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const candidates = await readProfileStatusCandidates(page, handle);
    const match = selectNewOwnedStatus(candidates, handle, expectedText, baseline);
    if (match) return match;
    await sleep(2000);
  }
  return {
    success: false,
    error: "No newly published post was detected on your X profile.",
    errorCode: "timeout",
  };
}

async function main() {
  const { port, payload } = parseArgs(process.argv);
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page = pages.find((p) => p.url().includes("x.com")) ?? pages[0] ?? (await context.newPage());

    await page.bringToFront().catch(() => {});
    await assertXLoggedIn(page);
    const handle = payload.expectedHandle ?? (await detectXDisplayHandle(page));
    if (!handle) {
      emit({
        success: false,
        error: "Could not detect the logged-in X handle.",
        errorCode: "session_expired",
      });
      return;
    }

    const baseline = await captureProfileStatusBaseline(page, handle);
    await fillCompose(page, payload);

    await page.locator(X_SELECTORS.tweetButton).waitFor({ timeout: 5_000 });
    await page.locator(X_SELECTORS.tweetButton).click();
    await sleep(2000);

    const result = await waitForVerifiedPost(page, payload.text, handle, baseline);
    emit(result.success ? { ...result, handle } : result);
  } catch (err) {
    const message = err?.message ?? String(err);
    const errorCode = err?.errorCode ?? (message.toLowerCase().includes("captcha") ? "captcha" : "unknown");
    emit({ success: false, error: message, errorCode });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
