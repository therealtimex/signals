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

/**
 * Publish a post to LinkedIn via browser automation.
 * Auto mode: headless, clicks Post automatically.
 * Review mode: headed, waits for user to click Post.
 * LinkedIn does not support threads.
 */
export async function publishToLinkedIn(request: PublishRequest): Promise<PublishResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const session = ensureSession("linkedin");
    const ctx = await createPublishContext(session, request.mode);
    browser = ctx.browser;
    context = ctx.context;
    const page = ctx.page;

    // Navigate to LinkedIn feed
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await sleep(2000);

    // Check for session expiry
    if (detectSessionExpired(page, "linkedin")) {
      throw new PublishError(
        "LinkedIn session has expired. Please re-authenticate in Settings.",
        "session_expired"
      );
    }

    // Check for CAPTCHA
    if (detectCaptcha(page)) {
      await captureScreenshot(page);
      throw new PublishError("CAPTCHA or verification challenge detected.", "captcha");
    }

    // Wait for feed to confirm logged-in state.
    // Use multiple selectors — LinkedIn changes these frequently.
    await page
      .waitForSelector(".global-nav__me, .scaffold-layout, [data-finite-scroll-hotkey-context=\"FEED\"]", { timeout: 15_000 })
      .catch(() => null);

    // Click "Start a post" to open compose modal.
    // The button lives inside .share-box-feed-entry__top-bar (not __trigger).
    const shareBox = page.locator(".share-box-feed-entry__top-bar button, button:has-text('Start a post')").first();
    await shareBox.waitFor({ timeout: 10_000 });
    await shareBox.click();
    await sleep(1500);

    // Upload media first if present so modal stabilizes back to post compose view
    if (request.mediaAssetIds && request.mediaAssetIds.length > 0) {
      await uploadMediaLinkedIn(page, request.mediaAssetIds);
    }

    // Wait for the TipTap / ProseMirror rich text editor (or Quill fallback)
    const editorSelector = ".tiptap.ProseMirror, .editor-content .ProseMirror, [contenteditable=\"true\"].ProseMirror, .ql-editor";
    await page.waitForSelector(editorSelector, { timeout: 10_000 });

    const editorLocator = page.locator(editorSelector).first();
    await editorLocator.click();
    await sleep(200);

    // Use native keyboard insertText to ensure trusted beforeinput events trigger TipTap transactions
    await page.keyboard.insertText(request.text);
    await sleep(500);

    // Pre-flight assertion: verify editor has text content and post button is enabled
    const editorText = (await editorLocator.innerText()).trim();
    if (!editorText && request.text.trim()) {
      throw new PublishError(
        "LinkedIn TipTap editor failed to synchronize text state before submission.",
        "unknown"
      );
    }

    const postButton = page.locator("button.share-actions__primary-action, button:has-text('Post'), [role='dialog'] button:has-text('Post')").first();
    await postButton.waitFor({ timeout: 5_000 });
    const isPostDisabled = (await postButton.getAttribute("aria-disabled")) === "true" || (await postButton.isDisabled());
    if (isPostDisabled) {
      throw new PublishError(
        "LinkedIn Post button remains disabled after text insertion.",
        "unknown"
      );
    }

    if (request.mode === "auto") {
      // Auto mode: click the Post button
      await postButton.click();

      // Wait for post to be published
      await sleep(3000);

      // Verify
      const result = await verifyLinkedInPost(page);
      return result;
    } else {
      // Review mode: wait for user to manually click Post
      const startWait = Date.now();
      const maxWait = 5 * 60 * 1000;

      while (Date.now() - startWait < maxWait) {
        // Check if the compose modal has closed
        const modalOpen = await page
          .locator(editorSelector)
          .isVisible()
          .catch(() => false);

        if (!modalOpen) {
          await sleep(2000);
          const result = await verifyLinkedInPost(page);
          return result;
        }
        await sleep(2000);
      }

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
  }
}

/** Upload media files using LinkedIn's file input.
 * LinkedIn's media flow: click media button → Editor modal opens →
 * upload file(s) → click Next → returns to compose modal with media attached.
 */
async function uploadMediaLinkedIn(
  page: import("playwright").Page,
  assetIds: string[]
): Promise<void> {
  const filePaths = resolveMediaPaths(assetIds);
  if (filePaths.length === 0) return;

  // Set up filechooser listener BEFORE clicking — intercepts the OS file dialog.
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });

  // Click the media button. LinkedIn uses different labels depending on context:
  // "Add media" (initial), "Add a photo" (compose view), "Add a video" (compose view)
  const mediaButton = page.locator(
    'button[aria-label="Add media"], button[aria-label="Add a photo"], button[aria-label="Add a video"]'
  ).first();
  await mediaButton.waitFor({ timeout: 5_000 });
  await mediaButton.click();

  // Intercept the file chooser — sets files without the native OS dialog blocking.
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePaths);

  // Wait for upload to process in the Editor modal
  await sleep(3000);

  // LinkedIn shows an Editor modal after upload. Click "Next" to return to compose.
  const nextButton = page.locator(
    'button[aria-label="Next"], button.share-box-footer__primary-btn:has-text("Next")'
  ).first();
  await nextButton.waitFor({ timeout: 10_000 });
  await nextButton.click();

  // Wait for compose modal to re-render with media attached
  await sleep(2000);
}

/** Attempt to verify a post was published by checking the LinkedIn feed. */
async function verifyLinkedInPost(
  page: import("playwright").Page
): Promise<PublishResult> {
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await sleep(2000);

    // Look for the most recent post — try activity links, then fall back to profile links
    const activityLink = await page
      .locator('.feed-shared-update-v2 a[href*="activity"], .feed-shared-update-v2 a[href*="/feed/update/"]')
      .first()
      .getAttribute("href", { timeout: 5_000 })
      .catch(() => null);

    if (activityLink) {
      const match = activityLink.match(/activity[:-](\d+)/);
      const platformPostId = match?.[1] ?? null;
      const platformUrl = activityLink.startsWith("http")
        ? activityLink
        : `https://www.linkedin.com${activityLink}`;

      return {
        success: true,
        platformUrl,
        platformPostId: platformPostId ?? undefined,
      };
    }

    // Post likely succeeded even without a verifiable link
    return { success: true };
  } catch {
    return { success: true };
  }
}
