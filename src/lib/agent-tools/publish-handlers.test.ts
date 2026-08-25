import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentItem, getContentItem } from "@/lib/db/queries/content";
import {
  createPublishJob,
  getPublishJobById,
  supersedeActiveJobsForContentItem,
} from "@/lib/db/queries/publish-jobs";
import {
  handleCompletePublish,
  handleUpdatePublishJob,
} from "@/lib/agent-tools/publish-handlers";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { contentPosts } from "@/lib/db/schema";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { ensureSessionPlatformAccount } from "@/lib/publish/ensure-platform-account";
import {
  acquireSessionLease,
  getSessionLease,
  releaseSessionLease,
} from "@/lib/leases/session-lease";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";

function seedDraftAndJob() {
  const item = createContentItem({
    body: "Agent publish body",
    title: "Test",
    contentType: "post",
    platformTarget: "x",
    status: "draft",
    origin: "authored",
    direction: "outbound",
    platformAccountId: null,
  });

  const job = createPublishJob({
    contentItemId: item.id,
    payload: {
      text: "Agent publish body",
      mediaAssetIds: [],
      platforms: ["x"],
      composedAt: Math.floor(Date.now() / 1000),
    },
    platforms: ["x"],
  });

  return { item, job };
}

describe("publish agent-tool handlers", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("schedules terminal release and stops browsers when the publish job reaches a terminal state", async () => {
    const { job } = seedDraftAndJob();
    const browserSpy = vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: ["signals-publish"],
      failed: [],
    });
    const scheduleSpy = vi
      .spyOn(resourceTeardown, "scheduleTerminalSessionRelease")
      .mockReturnValue({ scheduled: true, sessionId: null });

    const result = await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: true,
      handle: "@user",
      platformPostId: "123",
      platformUrl: "https://x.com/user/status/123",
    });

    expect(browserSpy).toHaveBeenCalledWith({
      sessionNames: ["signals-publish"],
      stopAllRunning: true,
    });
    expect(scheduleSpy).toHaveBeenCalledWith(null);
    expect(result).toMatchObject({
      browserSessionTeardown: { stopped: ["signals-publish"], failed: [] },
      terminalSessionTeardown: { scheduled: false },
    });
  });

  it("does not regress terminal targets on duplicate update_publish_job", async () => {
    const { job } = seedDraftAndJob();

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: true,
      handle: "@user",
      platformPostId: "123",
      platformUrl: "https://x.com/user/status/123",
    });

    const afterPublish = getPublishJobById(job.id);
    expect(afterPublish?.targetsParsed[0]?.status).toBe("published");

    await handleUpdatePublishJob({
      jobId: job.id,
      platform: "x",
      status: "publishing",
    });

    const afterDuplicate = getPublishJobById(job.id);
    expect(afterDuplicate?.targetsParsed[0]?.status).toBe("published");
    expect(afterDuplicate?.status).toBe("completed");
  });

  it("derives platformUrl from platformPostId when complete_publish omits it", async () => {
    const { item, job } = seedDraftAndJob();

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: true,
      handle: "@user",
      platformPostId: "9876543210",
    });

    const post = db.select().from(contentPosts).all().find((row) => row.contentItemId === item.id);
    expect(post?.platformUrl).toBe("https://x.com/i/status/9876543210");

    const updated = getPublishJobById(job.id);
    expect(updated?.targetsParsed[0]?.platformUrl).toBe("https://x.com/i/status/9876543210");
  });

  it("records late callbacks on superseded jobs without driving item status", async () => {
    const { item, job } = seedDraftAndJob();

    supersedeActiveJobsForContentItem(item.id);
    const superseded = getPublishJobById(job.id);
    expect(superseded?.status).toBe("superseded");

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: true,
      handle: "@user",
      platformPostId: "999",
      platformUrl: "https://x.com/user/status/999",
    });

    const recorded = getPublishJobById(job.id);
    expect(recorded?.status).toBe("superseded");
    expect(recorded?.targetsParsed[0]?.status).toBe("published");
    expect(recorded?.targetsParsed[0]?.platformPostId).toBe("999");

    const itemAfter = getContentItem(item.id);
    expect(itemAfter?.status).toBe("draft");
  });

  it("treats duplicate complete_publish failure as idempotent when diagnostics are omitted", async () => {
    const { job } = seedDraftAndJob();

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: false,
    });

    const retry = await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: false,
    });

    expect(retry).toMatchObject({
      jobId: job.id,
      idempotent: true,
    });
    expect(getPublishJobById(job.id)?.targetsParsed[0]).toMatchObject({
      status: "failed",
      error: "Publish failed",
      errorCode: "unknown",
    });
  });

  it("recomputes partial job status for active jobs", async () => {
    const item = createContentItem({
      body: "Multi",
      title: "Multi",
      contentType: "post",
      platformTarget: "x,linkedin",
      status: "queued",
      origin: "authored",
      direction: "outbound",
      platformAccountId: null,
    });

    const job = createPublishJob({
      contentItemId: item.id,
      payload: {
        text: "Multi",
        mediaAssetIds: [],
        platforms: ["x", "linkedin"],
        composedAt: Math.floor(Date.now() / 1000),
      },
      platforms: ["x", "linkedin"],
    });

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      success: true,
      handle: "@user",
      platformPostId: "111",
      platformUrl: "https://x.com/user/status/111",
    });

    await handleCompletePublish({
      jobId: job.id,
      platform: "linkedin",
      success: false,
      error: "unsupported",
      errorCode: "unknown",
    });

    const updated = getPublishJobById(job.id);
    expect(updated?.status).toBe("partial");
    expect(getContentItem(item.id)?.status).toBe("published");
  });

  it("matches same-platform callbacks by targetId and writes the acting target audit", async () => {
    const { item } = seedDraftAndJob();
    const account = ensureSessionPlatformAccount("x", "@first");
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const first = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      name: "First",
      handle: "@first",
      platformAccountId: account.id,
      source: "test",
    });
    const second = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      name: "Second",
      handle: "@second",
      platformAccountId: account.id,
      source: "test",
    });
    const job = createPublishJob({
      contentItemId: item.id,
      payload: {
        text: "Agent publish body",
        mediaAssetIds: [],
        platforms: ["x"],
        composedAt: Math.floor(Date.now() / 1000),
      },
      platforms: ["x"],
      targets: [
        { platform: "x", targetId: first.id, expectedHandle: "@first", status: "pending" },
        { platform: "x", targetId: second.id, expectedHandle: "@second", status: "pending" },
      ],
    });

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      targetId: second.id,
      success: true,
      handle: "@second",
      platformPostId: "targeted-2",
    });

    expect(getPublishJobById(job.id)?.targetsParsed).toMatchObject([
      { targetId: first.id, status: "pending" },
      { targetId: second.id, status: "published" },
    ]);
    expect(db.select().from(contentPosts).all()).toContainEqual(
      expect.objectContaining({ targetId: second.id, platformPostId: "targeted-2" })
    );
  });

  it("records completion after a stale lease and reports the fencing violation", async () => {
    const { job } = seedDraftAndJob();
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const lease = acquireSessionLease(connection.id, { holder: "publisher" });
    releaseSessionLease(lease.leaseId);

    const result = await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      leaseId: lease.leaseId,
      success: false,
      error: "wrong account",
      errorCode: "wrong_account",
    });
    expect(result).toMatchObject({ leaseStale: true });
    expect(getPublishJobById(job.id)?.targetsParsed[0]).toMatchObject({
      status: "failed",
      errorCode: "wrong_account",
    });
  });

  it("does not shorten a long lease during status callbacks", async () => {
    const { job } = seedDraftAndJob();
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const lease = acquireSessionLease(connection.id, {
      holder: "publisher",
      ttlSeconds: 1_800,
    });

    await handleUpdatePublishJob({
      jobId: job.id,
      platform: "x",
      leaseId: lease.leaseId,
      status: "publishing",
    });
    expect(getSessionLease(connection.id)).toMatchObject({
      leaseId: lease.leaseId,
      expiresAt: expect.any(Number),
      renewedAt: expect.any(Number),
    });
    const afterUpdate = getSessionLease(connection.id)!;
    expect(afterUpdate.expiresAt - afterUpdate.renewedAt).toBe(1_800);

    await handleCompletePublish({
      jobId: job.id,
      platform: "x",
      leaseId: lease.leaseId,
      success: false,
      error: "stopped",
    });
    const afterComplete = getSessionLease(connection.id)!;
    expect(afterComplete.expiresAt - afterComplete.renewedAt).toBe(1_800);
  });
});
