import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import type { PublishRequest } from "@/lib/browser/publishers/types";
import { PublishError } from "@/lib/browser/publishers/types";
import { connectToXContentPage } from "@/lib/browser/rtx-publish/connect";
import {
  createDesktopBrowserApiClient,
  findPublishSessionRecord,
  parseXContentTabsFromSession,
} from "@/lib/browser/rtx-publish/desktop-browser-client";
import { probeLoggedInXTab } from "@/lib/browser/rtx-publish/x-publish-tab-login";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/browser/rtx-publish/constants";
import { ensureXPlatformAccount } from "@/lib/browser/rtx-publish/ensure-platform-account";
import {
  resolveCdpPortOverride,
  resolveRtxPublishSession,
  stopRtxPublishSession,
  type ResolveSessionDeps,
} from "@/lib/browser/rtx-publish/resolve-session";
import type { XPublishRtxResult } from "@/lib/browser/rtx-publish/types";
import {
  prepareLoggedInXPage,
  runXAutoPublishSteps,
  runXReviewPublishSteps,
} from "@/lib/browser/rtx-publish/x-publish-steps";

export type ExecuteXPublishRtxDeps = Partial<ResolveSessionDeps> & {
  connectToXContentPage?: typeof connectToXContentPage;
  env?: EnvLike;
};

const STANDALONE_MESSAGE =
  "X publish requires the RealTimeX Local App. Run Signals as an embedded Local App or set SIGNALS_RTX_CDP_PORT for development.";

function mapExecutorError(err: unknown): XPublishRtxResult {
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
}

/**
 * Publish to X via RealTimeX Browser + CDP automation.
 * Replaces in-process Playwright launch for platform === "x".
 */
export async function executeXPublishRtx(
  request: PublishRequest,
  deps: ExecuteXPublishRtxDeps = {}
): Promise<XPublishRtxResult> {
  const env = deps.env ?? process.env;
  const connect = deps.connectToXContentPage ?? connectToXContentPage;

  if (!isRtxEmbedded(env) && resolveCdpPortOverride(env) === null) {
    return {
      success: false,
      error: STANDALONE_MESSAGE,
      errorCode: "session_expired",
    };
  }

  let browser: Awaited<ReturnType<typeof connectToXContentPage>>["browser"] | null = null;
  let publishResult: XPublishRtxResult | null = null;

  try {
    const session = await resolveRtxPublishSession(deps);

    let selectedTabUrl = session.contentTabUrl;
    let selectedHandle = session.selectedHandle ?? null;
    let sessionTabs = session.tabs ?? [];

    if (
      !selectedHandle &&
      isRtxEmbedded(env) &&
      resolveCdpPortOverride(env) === null
    ) {
      const desktopClient = createDesktopBrowserApiClient(env);
      if (sessionTabs.length === 0) {
        try {
          const listed = await desktopClient.listSessions();
          const record = findPublishSessionRecord(listed, RTX_PUBLISH_SESSION_NAME);
          sessionTabs = parseXContentTabsFromSession(record);
        } catch {
          sessionTabs = [];
        }
      }

      const probe = sessionTabs.length > 0 ? await probeLoggedInXTab(sessionTabs, desktopClient) : null;
      if (probe) {
        selectedTabUrl = probe.tab.url;
        selectedHandle = probe.handle;
      }
    }

    const connection = await connect(session.remoteDebugPort, {
      preferredTabUrl: selectedTabUrl,
    });
    browser = connection.browser;
    const { page } = connection;

    const handle = await prepareLoggedInXPage(page, selectedHandle);
    const account = ensureXPlatformAccount(handle);

    const result =
      request.mode === "auto"
        ? await runXAutoPublishSteps(page, request, handle)
        : await runXReviewPublishSteps(page, request, handle);

    if (!result.success) {
      publishResult = result;
      return result;
    }

    publishResult = {
      ...result,
      platformAccountId: account.id,
    };
    return publishResult;
  } catch (err) {
    publishResult = mapExecutorError(err);
    return publishResult;
  } finally {
    await browser?.close().catch(() => {});

    if (request.mode === "auto" && publishResult?.success) {
      await stopRtxPublishSession(deps);
    }
  }
}
