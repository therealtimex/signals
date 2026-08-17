import { beforeEach, describe, expect, it } from "vitest";
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
});
