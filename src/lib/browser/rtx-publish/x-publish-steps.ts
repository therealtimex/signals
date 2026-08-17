import type { Page } from "playwright";
import { sleep } from "@/lib/browser/anti-detection";
import {
  captureScreenshot,
  detectCaptcha,
  humanTypeText,
  resolveMediaPaths,
} from "@/lib/browser/publishers/publish-utils";
import { PublishError } from "@/lib/browser/publishers/types";
import type { PublishRequest, PublishResult } from "@/lib/browser/publishers/types";
import { X_HOME_URL, getAutoVerifyTimeoutMs, getProfileTimelinePollMs, getProfileTimelineTimeoutMs, getReviewVerifyTimeoutMs, getVerifyPollIntervalMs } from "@/lib/browser/rtx-publish/constants";
import {
  assertXLoggedIn,
  isXLoginUrl,
  prepareLoggedInXPage,
} from "@/lib/browser/rtx-publish/x-publish-login";
import {
  buildTimelineSnapshotSignature,
  extractStatusIdFromHref,
  isStatusOwnedByHandle,
  maxStatusIdNumeric,
  normalizeTweetText,
  selectNewOwnedStatus,
  type ProfileStatusBaseline,
  type ProfileStatusCandidate,
} from "@/lib/browser/rtx-publish/x-publish-verification";
import { X_SELECTORS } from "@/lib/browser/rtx-publish/x-publish-selectors";

export { isXLoginUrl, prepareLoggedInXPage } from "@/lib/browser/rtx-publish/x-publish-login";

export type ProfileTimelineScan = {
  ownedCandidates: ProfileStatusCandidate[];
  statusLinkKeys: string[];
};

const PROFILE_TIMELINE_STABLE_READS = 2;

export type ProfileTimelineReadiness = {
  confirmedEmpty: boolean;
  candidates: ProfileStatusCandidate[];
};

/** Wait until the owned-status snapshot on the profile timeline is stable (fail closed). */
export async function waitForProfileTimelineReady(
  page: Page,
  handle: string
): Promise<ProfileTimelineReadiness> {
  const profileHandle = handle.replace(/^@/, "");
  const deadline = Date.now() + getProfileTimelineTimeoutMs();
  let lastSignature: string | null = null;
  let stableReads = 0;

  try {
    await page.goto(`https://x.com/${profileHandle}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
  } catch {
    throw new PublishError("Timed out loading your X profile for verification.", "timeout");
  }

  while (Date.now() < deadline) {
    await sleep(getProfileTimelinePollMs());

    const primaryVisible = await page
      .locator(X_SELECTORS.primaryColumn)
      .isVisible()
      .catch(() => false);
    if (!primaryVisible) {
      stableReads = 0;
      lastSignature = null;
      continue;
    }

    const loading = await page.locator('[role="progressbar"]').isVisible().catch(() => false);
    if (loading) {
      stableReads = 0;
      lastSignature = null;
      continue;
    }

    const articleCount = await page.locator("article").count();
    const emptyVisible = await page
      .locator('[data-testid="emptyState"]')
      .isVisible()
      .catch(() => false);
    const scan = await readProfileTimelineScan(page, handle, { skipNavigation: true });
    const signature = buildTimelineSnapshotSignature(
      articleCount,
      emptyVisible,
      scan.statusLinkKeys,
      scan.ownedCandidates
    );
    if (!signature) {
      stableReads = 0;
      lastSignature = null;
      continue;
    }

    if (lastSignature === signature) {
      stableReads++;
      if (stableReads >= PROFILE_TIMELINE_STABLE_READS) {
        return {
          confirmedEmpty: signature === "empty",
          candidates: signature === "empty" ? [] : scan.ownedCandidates,
        };
      }
    } else {
      stableReads = 1;
      lastSignature = signature;
    }
  }

  throw new PublishError(
    "X profile timeline did not finish loading. Try again in RealTimeX Browser.",
    "timeout"
  );
}

/** Collect owned status baseline after the profile timeline is demonstrably loaded. */
export async function captureProfileStatusBaseline(
  page: Page,
  handle: string
): Promise<ProfileStatusBaseline> {
  const readiness = await waitForProfileTimelineReady(page, handle);
  const capturedAtMs = Date.now();
  const statusIds = new Set(readiness.candidates.map((candidate) => candidate.statusId));
  return {
    statusIds,
    timelineReady: true,
    snapshotComplete: true,
    maxStatusId: maxStatusIdNumeric(statusIds),
    confirmedEmpty: readiness.confirmedEmpty,
    capturedAtMs,
  };
}

export async function readProfileTimelineScan(
  page: Page,
  handle: string,
  options: { skipNavigation?: boolean } = {}
): Promise<ProfileTimelineScan> {
  const profileHandle = handle.replace(/^@/, "");
  if (!options.skipNavigation) {
    try {
      await page.goto(`https://x.com/${profileHandle}`, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch {
      throw new PublishError("Timed out loading your X profile for verification.", "timeout");
    }
    await sleep(getProfileTimelinePollMs());
  }

  const articles = page.locator("article");
  const count = await articles.count();
  const ownedCandidates: ProfileStatusCandidate[] = [];
  const statusLinkKeys: string[] = [];

  for (let i = 0; i < Math.min(count, 12); i++) {
    const article = articles.nth(i);
    const text = normalizeTweetText((await article.innerText().catch(() => "")) || "");
    const links = article.locator('a[href*="/status/"]');
    const linkCount = await links.count();
    let articleLinkKey: string | null = null;

    for (let j = 0; j < linkCount; j++) {
      const href = await links.nth(j).getAttribute("href").catch(() => null);
      const statusId = extractStatusIdFromHref(href);
      if (!href || !statusId) continue;

      articleLinkKey ??= href;
      if (isStatusOwnedByHandle(href, handle)) {
        ownedCandidates.push({ statusId, href, text });
        break;
      }
    }

    if (articleLinkKey) {
      statusLinkKeys.push(articleLinkKey);
    }
  }

  return { ownedCandidates, statusLinkKeys };
}

export async function readProfileStatusCandidates(
  page: Page,
  handle: string,
  options: { skipNavigation?: boolean } = {}
): Promise<ProfileStatusCandidate[]> {
  const scan = await readProfileTimelineScan(page, handle, options);
  return scan.ownedCandidates;
}

async function uploadMediaX(page: Page, assetIds: string[]): Promise<void> {
  const filePaths = resolveMediaPaths(assetIds);
  if (filePaths.length === 0) return;

  const fileInput = page.locator(X_SELECTORS.fileInput).first();
  try {
    await fileInput.waitFor({ timeout: 5_000 });
    await fileInput.setInputFiles(filePaths);
  } catch {
    throw new PublishError(
      "Timed out attaching media in X compose.",
      "upload_failed"
    );
  }

  try {
    await page.waitForSelector(X_SELECTORS.attachments, { timeout: 30_000 });
  } catch {
    try {
      await fileInput.setInputFiles(filePaths);
      await page.waitForSelector(X_SELECTORS.attachments, { timeout: 30_000 });
    } catch {
      throw new PublishError(
        "Failed to upload media to X. Files may be too large or unsupported.",
        "upload_failed"
      );
    }
  }
  await sleep(1000);
}

async function findNewPublishedStatusOnProfile(
  page: Page,
  expectedText: string,
  handle: string,
  baseline: ProfileStatusBaseline
): Promise<PublishResult> {
  const candidates = await readProfileStatusCandidates(page, handle);
  const match = selectNewOwnedStatus(candidates, handle, expectedText, baseline);
  if (match) return match;

  return {
    success: false,
    error: "No newly published post was detected on your X profile.",
    errorCode: "unknown",
  };
}

async function waitForNewVerifiedPost(
  page: Page,
  expectedText: string,
  handle: string,
  baseline: ProfileStatusBaseline,
  timeoutMs: number
): Promise<PublishResult> {
  const started = Date.now();
  let lastError = "No newly published post was detected on your X profile.";

  while (true) {
    const result = await findNewPublishedStatusOnProfile(page, expectedText, handle, baseline);
    if (result.success) return result;
    lastError = result.error ?? lastError;
    if (timeoutMs === 0 || Date.now() - started >= timeoutMs) break;
    await sleep(getVerifyPollIntervalMs());
  }

  return { success: false, error: lastError, errorCode: "timeout" };
}

async function fillCompose(page: Page, request: PublishRequest): Promise<void> {
  try {
    await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    throw new PublishError("Timed out loading X compose.", "timeout");
  }
  await sleep(1000);
  await assertXLoggedIn(page);

  const composeButton = page.locator(X_SELECTORS.composeButton);
  try {
    await composeButton.waitFor({ timeout: 10_000 });
    await composeButton.click();
  } catch {
    throw new PublishError("Timed out opening X compose.", "timeout");
  }
  await sleep(1000);

  try {
    await page.waitForSelector(X_SELECTORS.tweetTextarea(0), { timeout: 10_000 });
    await humanTypeText(page, X_SELECTORS.tweetTextarea(0), request.text, 20);
  } catch {
    throw new PublishError("Timed out entering post text in X compose.", "timeout");
  }
  await sleep(500);

  if (request.mediaAssetIds && request.mediaAssetIds.length > 0) {
    await uploadMediaX(page, request.mediaAssetIds);
  }

  if (request.threadTexts && request.threadTexts.length > 0) {
    for (let i = 0; i < request.threadTexts.length; i++) {
      const addButton = page.locator(X_SELECTORS.addButton);
      try {
        await addButton.waitFor({ timeout: 5_000 });
        await addButton.click();
      } catch {
        throw new PublishError("Timed out adding a thread tweet in X compose.", "timeout");
      }
      await sleep(800);

      const textareaSelector = X_SELECTORS.tweetTextarea(i + 1);
      try {
        await page.waitForSelector(textareaSelector, { timeout: 5_000 });
        await humanTypeText(page, textareaSelector, request.threadTexts[i], 20);
      } catch {
        throw new PublishError("Timed out entering thread text in X compose.", "timeout");
      }
      await sleep(300);

      if (request.threadMediaIds?.[i]?.length) {
        await uploadMediaX(page, request.threadMediaIds[i]);
      }
    }
  }
}

/** Run auto-publish: baseline → fill → post → verify new owned status. */
export async function runXAutoPublishSteps(
  page: Page,
  request: PublishRequest,
  handle: string
): Promise<PublishResult> {
  const baseline = await captureProfileStatusBaseline(page, handle);
  await fillCompose(page, request);

  const postButton = page.locator(X_SELECTORS.tweetButton);
  try {
    await postButton.waitFor({ timeout: 5_000 });
    await postButton.click();
  } catch {
    throw new PublishError("Timed out clicking Post in X compose.", "timeout");
  }

  await page
    .waitForSelector(X_SELECTORS.tweetTextarea(0), { state: "hidden", timeout: 30_000 })
    .catch(() => {});
  await sleep(2000);

  return waitForNewVerifiedPost(
    page,
    request.text,
    handle,
    baseline,
    getAutoVerifyTimeoutMs()
  );
}

/** Run review-publish: baseline → fill → wait for user post → verify new owned status. */
export async function runXReviewPublishSteps(
  page: Page,
  request: PublishRequest,
  handle: string
): Promise<PublishResult> {
  const baseline = await captureProfileStatusBaseline(page, handle);
  await fillCompose(page, request);

  const startWait = Date.now();
  const maxWait = 5 * 60 * 1000;

  while (Date.now() - startWait < maxWait) {
    const composeOpen = await page
      .locator(X_SELECTORS.tweetTextarea(0))
      .isVisible()
      .catch(() => false);

    if (!composeOpen) {
      const verified = await waitForNewVerifiedPost(
        page,
        request.text,
        handle,
        baseline,
        getReviewVerifyTimeoutMs()
      );
      if (verified.success) return verified;
      return {
        success: false,
        error:
          "Compose closed without detecting a newly published post. You may have canceled or navigated away.",
        errorCode: "unknown",
      };
    }
    await sleep(2000);
  }

  return {
    success: false,
    error: "Review mode timed out after 5 minutes. Post may not have been published.",
    errorCode: "timeout",
  };
}
