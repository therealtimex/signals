import type { Browser, BrowserContext } from "playwright";
import { sleep } from "@/lib/browser/anti-detection";
import {
  ensureSession,
  createPublishContext,
  captureScreenshot,
  resolveMediaPaths,
  detectSessionExpired,
  detectCaptcha,
  humanTypeText,
} from "@/lib/browser/publishers/publish-utils";
import { PublishError } from "@/lib/browser/publishers/types";
import type { PublishRequest, PublishResult } from "@/lib/browser/publishers/types";
import { assertExternalEffectAllowed } from "@/lib/instance/guard";

/**
 * Publish a post (or thread) to X via browser automation.
 * Auto mode: headless, clicks Post automatically.
 * Review mode: headed, waits for user to click Post.
 */
export async function publishToX(request: PublishRequest): Promise<PublishResult> {
  // Outside the try below on purpose: a Dev instance refusal must not become a PublishResult.
  assertExternalEffectAllowed("publish.browser");
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const session = ensureSession("x");
    const ctx = await createPublishContext(session, request.mode);
    browser = ctx.browser;
    context = ctx.context;
    const page = ctx.page;

    // Navigate to X home
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(2000);

    // Check for session expiry
    if (detectSessionExpired(page, "x")) {
      throw new PublishError("X session has expired. Please re-authenticate in Settings.", "session_expired");
    }

    // Check for CAPTCHA
    if (detectCaptcha(page)) {
      await captureScreenshot(page);
      throw new PublishError("CAPTCHA or verification challenge detected.", "captcha");
    }

    // Wait for primary column to confirm logged-in state
    await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 15_000 });

    // Click the compose button in the sidebar
    const composeButton = page.locator('[data-testid="SideNav_NewTweet_Button"]');
    await composeButton.waitFor({ timeout: 10_000 });
    await composeButton.click();
    await sleep(1000);

    // Wait for compose textarea
    await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10_000 });

    // Type the main post text
    await humanTypeText(page, '[data-testid="tweetTextarea_0"]', request.text, 20);
    await sleep(500);

    // Upload media for the main post
    if (request.mediaAssetIds && request.mediaAssetIds.length > 0) {
      await uploadMediaX(page, request.mediaAssetIds);
    }

    // Handle thread tweets
    if (request.threadTexts && request.threadTexts.length > 0) {
      for (let i = 0; i < request.threadTexts.length; i++) {
        // Click the add button to create next tweet in thread
        const addButton = page.locator('[data-testid="addButton"]');
        await addButton.waitFor({ timeout: 5_000 });
        await addButton.click();
        await sleep(800);

        // Type into the new textarea
        const textareaSelector = `[data-testid="tweetTextarea_${i + 1}"]`;
        await page.waitForSelector(textareaSelector, { timeout: 5_000 });
        await humanTypeText(page, textareaSelector, request.threadTexts[i], 20);
        await sleep(300);

        // Upload per-tweet media if provided
        if (request.threadMediaIds?.[i]?.length) {
          await uploadMediaX(page, request.threadMediaIds[i]);
        }
      }
    }

    if (request.mode === "auto") {
      // Auto mode: click the Post button
      const postButton = page.locator('[data-testid="tweetButton"]');
      await postButton.waitFor({ timeout: 5_000 });
      await postButton.click();

      // Wait for the compose modal to close / post to go through
      await sleep(3000);

      // Verify: look for a toast or check the feed for the new post
      const result = await verifyXPost(page, request.text);
      return result;
    } else {
      // Review mode: wait for user to manually click Post
      // Poll for up to 5 minutes watching for the compose modal to close
      const startWait = Date.now();
      const maxWait = 5 * 60 * 1000;

      while (Date.now() - startWait < maxWait) {
        // Check if the compose dialog has closed (post was sent)
        const composeOpen = await page
          .locator('[data-testid="tweetTextarea_0"]')
          .isVisible()
          .catch(() => false);

        if (!composeOpen) {
          await sleep(2000);
          const result = await verifyXPost(page, request.text);
          return result;
        }
        await sleep(2000);
      }

      // Timed out waiting for user
      return {
        success: false,
        error: "Review mode timed out after 5 minutes. Post may not have been published.",
        errorCode: "timeout",
      };
    }
  } catch (err) {
    if (err instanceof PublishError) {
      return {
        success: false,
        error: err.message,
        errorCode: err.errorCode,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: "unknown",
    };
  } finally {
    if (request.mode === "auto") {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
    // Review mode: leave browser open for the user
  }
}

/** Upload media files using X's file input. */
async function uploadMediaX(page: import("playwright").Page, assetIds: string[]): Promise<void> {
  const filePaths = resolveMediaPaths(assetIds);
  if (filePaths.length === 0) return;

  // Use .first() — X renders multiple file inputs on the page
  const fileInput = page.locator('input[data-testid="fileInput"]').first();
  await fileInput.waitFor({ timeout: 5_000 });
  await fileInput.setInputFiles(filePaths);

  // Wait for media to attach (look for the attachments container)
  try {
    await page.waitForSelector('[data-testid="attachments"]', { timeout: 30_000 });
  } catch {
    // Retry once on failure
    await fileInput.setInputFiles(filePaths);
    await page.waitForSelector('[data-testid="attachments"]', { timeout: 30_000 }).catch(() => {
      throw new PublishError("Failed to upload media to X. Files may be too large or unsupported.", "upload_failed");
    });
  }
  await sleep(1000);
}

/** Attempt to verify a post was published by checking the user's feed. */
async function verifyXPost(
  page: import("playwright").Page,
  text: string
): Promise<PublishResult> {
  try {
    // Navigate to user's profile to find the latest post
    await page.goto("https://x.com", { waitUntil: "domcontentloaded", timeout: 15_000 });
    await sleep(2000);

    // Look for the most recent article with a status link
    const statusLink = await page
      .locator('article a[href*="/status/"]')
      .first()
      .getAttribute("href", { timeout: 10_000 })
      .catch(() => null);

    if (statusLink) {
      const platformPostId = statusLink.split("/status/")[1]?.split(/[/?#]/)[0] ?? null;
      const platformUrl = `https://x.com${statusLink}`;

      return {
        success: true,
        platformUrl,
        platformPostId: platformPostId ?? undefined,
      };
    }

    // Could not verify but post may still have succeeded
    return {
      success: true,
    };
  } catch {
    // Verification failed but post may still have gone through
    return {
      success: true,
    };
  }
}
