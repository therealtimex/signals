import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentItem, getContentItem } from "@/lib/db/queries/content";
import { getPublishJobById } from "@/lib/db/queries/publish-jobs";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { upsertVariant } from "@/lib/db/queries/variants";
import { handleGetPublishJob } from "@/lib/agent-tools/publish-handlers";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { buildWritingUnits, mergeContentWriting } from "@/lib/writing/content-writing";
import { resetCoreTables } from "@/test/db";

const env: NodeJS.ProcessEnv = {
  ...process.env,
  RTX_APP_ID: "app-test",
  RTX_API_BASE_URL: "http://127.0.0.1:3001",
  SIGNALS_RTX_WORKSPACE_SLUG: "signals",
};

let storageDir = "";

function fakeRtxFetch(dispatch = "success") {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
      return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
    }
    if (url.endsWith("/cli/create-thread/signals") && init?.method === "POST") {
      return new Response(JSON.stringify({ thread: { slug: "publish-thread" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/cli/send-message/signals/publish-thread") && init?.method === "POST") {
      if (dispatch === "failure") {
        return new Response(
          JSON.stringify({
            success: false,
            terminalDispatchAccepted: false,
            code: "TERMINAL_DISPATCH_REQUIRED",
            error: "No terminal agent configured",
          }),
          { status: 409 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          terminalDispatchAccepted: true,
          descriptor: { id: "runtime-1" },
          workspaceSlug: "signals",
          threadSlug: "publish-thread",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 500 });
  }) as unknown as typeof fetch;
}

function createApprovedWritingItem(input?: {
  itemUnits?: string[];
  variantUnits?: string[];
  approvalState?: string;
  materializationHash?: string;
}) {
  const connection = ensureBrowserConnection({ sessionName: "writing-send-tests" });
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform: "x",
    kind: "account",
    name: "Approved target",
    handle: "@approved",
    capabilities: ["publish"],
    source: "test",
  });
  const launch = upsertLaunch({ name: "Writing launch" });
  const variantUnits = buildWritingUnits(input?.variantUnits ?? ["A", "B", "C"]);
  const variant = upsertVariant({
    launchId: launch.id,
    variantType: "thread",
    metadata: {
      writing: {
        audit: { id: "audit-1", inputHash: "hash-1", verdict: "pass" },
        approval: {
          state: input?.approvalState ?? "approved",
          at: 10,
          by: "user",
          auditId: "audit-1",
        },
        units: variantUnits,
        targetId: target.id,
      },
    },
  });
  const itemUnits = buildWritingUnits(input?.itemUnits ?? ["A", "B", "C"]);
  const item = createContentItem({
    title: "Thread",
    body: itemUnits.texts[0],
    contentType: "thread",
    platformTarget: "x",
    status: "approved",
    origin: "authored",
    direction: "outbound",
    aiGenerated: true,
    platformData: mergeContentWriting({}, {
      schemaVersion: 1,
      surface: "x/thread",
      capability: { publish: "direct" },
      units: itemUnits,
      variantId: variant.id,
      targetId: target.id,
      materialization: {
        auditId: "audit-1",
        inputHash: input?.materializationHash ?? "hash-1",
        approvalAt: 10,
        approvalBy: "user",
      },
    }),
  });
  return Object.assign(item, { approvedTargetId: target.id });
}

describe("send-to-agent writing gates", () => {
  beforeEach(() => {
    resetCoreTables();
    storageDir = mkdtempSync(join(tmpdir(), "signals-writing-send-tests-"));
    env.STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("rejects bare agent drafts and draft-only surfaces before provisioning", async () => {
    const draft = createContentItem({
      body: "Draft",
      contentType: "post",
      platformTarget: "x",
      status: "draft",
      platformData: mergeContentWriting({}, {
        schemaVersion: 1,
        surface: "x/post",
        capability: { publish: "direct" },
        units: buildWritingUnits(["Draft"]),
      }),
    });
    await expect(
      sendContentToAgent(
        { contentItemId: draft.id, platforms: ["x"], text: "bypass" },
        env,
        fakeRtxFetch(),
      ),
    ).resolves.toMatchObject({
      success: false,
      errorCode: "writing_approval_required",
    });

    const draftOnly = createContentItem({
      body: "Threads draft",
      contentType: "thread",
      platformTarget: "threads",
      status: "approved",
      platformData: mergeContentWriting({}, {
        schemaVersion: 1,
        surface: "threads/thread",
        capability: { publish: "draft_only" },
        units: buildWritingUnits(["A", "B"]),
      }),
    });
    const unsupported = await sendContentToAgent(
      {
        contentItemId: draftOnly.id,
        platforms: ["x"],
        text: "bypass",
      },
      env,
      fakeRtxFetch(),
    );
    expect(unsupported).toMatchObject({
      success: false,
      errorCode: "capability_unsupported",
    });
  });

  it("rejects revoked approval and every stale artifact mismatch", async () => {
    const revoked = createApprovedWritingItem({ approvalState: "revoked" });
    expect(
      await sendContentToAgent(
        { contentItemId: revoked.id, platforms: ["x"], text: "bypass" },
        env,
        fakeRtxFetch(),
      ),
    ).toMatchObject({ success: false, errorCode: "writing_approval_required" });

    const staleHash = createApprovedWritingItem({ materializationHash: "old-hash" });
    expect(
      await sendContentToAgent(
        { contentItemId: staleHash.id, platforms: ["x"], text: "bypass" },
        env,
        fakeRtxFetch(),
      ),
    ).toMatchObject({ success: false, errorCode: "writing_artifact_stale" });

    const staleUnits = createApprovedWritingItem({ itemUnits: ["changed"] });
    expect(
      await sendContentToAgent(
        { contentItemId: staleUnits.id, platforms: ["x"], text: "bypass" },
        env,
        fakeRtxFetch(),
      ),
    ).toMatchObject({ success: false, errorCode: "writing_artifact_stale" });
  });

  it("fails closed when the writing marker is present but malformed", async () => {
    const malformed = createContentItem({
      body: "Stored body",
      contentType: "post",
      platformTarget: "x",
      status: "approved",
      platformData: JSON.stringify({ writing: {} }),
    });

    await expect(
      sendContentToAgent(
        { contentItemId: malformed.id, platforms: ["x"], text: "caller bypass" },
        env,
        fakeRtxFetch(),
      ),
    ).resolves.toMatchObject({
      success: false,
      errorCode: "writing_artifact_stale",
    });
    expect(getContentItem(malformed.id)?.status).toBe("approved");
  });

  it("rejects omitted, substituted, and multiple acting targets", async () => {
    const item = createApprovedWritingItem();
    const connection = ensureBrowserConnection({ sessionName: "writing-send-tests" });
    const substituted = registerPlatformTarget({
      connectionId: connection.id,
      platform: "x",
      kind: "account",
      name: "Substituted target",
      handle: "@substituted",
      capabilities: ["publish"],
      source: "test",
    });

    for (const targets of [
      undefined,
      [{ targetId: substituted.id }],
      [{ targetId: item.approvedTargetId }, { targetId: substituted.id }],
    ]) {
      await expect(
        sendContentToAgent(
          { contentItemId: item.id, platforms: ["x"], targets, text: "bypass" },
          env,
          fakeRtxFetch(),
        ),
      ).resolves.toMatchObject({ success: false, errorCode: "invalid_target" });
    }
  });

  it("ignores caller text and carries persisted X thread units through the job API", async () => {
    const item = createApprovedWritingItem();
    const result = await sendContentToAgent(
      {
        contentItemId: item.id,
        platforms: ["x"],
        targets: [{ targetId: item.approvedTargetId }],
        text: "EVIL",
        threadTexts: ["EVIL2"],
        kind: "original",
        signalsBaseUrl: "http://127.0.0.1:3000",
      },
      env,
      fakeRtxFetch(),
    );
    expect(result).toMatchObject({
      success: true,
      payload: { text: "A", threadTexts: ["B", "C"], platforms: ["x"] },
    });
    if (!result.success) throw new Error(result.error);
    const job = getPublishJobById(result.jobId)!;
    expect(job.payloadParsed).toMatchObject({ text: "A", threadTexts: ["B", "C"] });
    expect(getContentItem(item.id)?.status).toBe("queued");
    await expect(handleGetPublishJob({ jobId: result.jobId })).resolves.toMatchObject({
      payload: { text: "A", threadTexts: ["B", "C"] },
    });
  });

  it("restores approved writing state when terminal dispatch fails", async () => {
    const item = createApprovedWritingItem();
    const result = await sendContentToAgent(
      {
        contentItemId: item.id,
        platforms: ["x"],
        targets: [{ targetId: item.approvedTargetId }],
        text: "ignored",
      },
      env,
      fakeRtxFetch("failure"),
    );
    expect(result).toMatchObject({ success: false, errorCode: "terminal_dispatch_required" });
    expect(getContentItem(item.id)?.status).toBe("approved");
  });

  it("preserves legacy caller text and restores legacy failures to draft", async () => {
    const legacy = createContentItem({
      body: "Stored",
      contentType: "post",
      platformTarget: "x",
      status: "failed",
      title: "Legacy",
    });
    const success = await sendContentToAgent(
      { contentItemId: legacy.id, platforms: ["x"], text: "Caller text" },
      env,
      fakeRtxFetch(),
    );
    expect(success).toMatchObject({ success: true, payload: { text: "Caller text" } });

    const failing = createContentItem({
      body: "Stored",
      contentType: "post",
      platformTarget: "x",
      status: "approved",
      title: "Legacy failure",
    });
    const failure = await sendContentToAgent(
      { contentItemId: failing.id, platforms: ["x"], text: "Caller text" },
      env,
      fakeRtxFetch("failure"),
    );
    expect(failure.success).toBe(false);
    expect(getContentItem(failing.id)?.status).toBe("draft");

    const nonThread = createContentItem({
      body: "Stored",
      contentType: "post",
      platformTarget: "x",
      status: "draft",
    });
    expect(
      await sendContentToAgent(
        {
          contentItemId: nonThread.id,
          platforms: ["x"],
          text: "Caller text",
          threadTexts: ["B"],
        },
        env,
        fakeRtxFetch(),
      ),
    ).toMatchObject({ success: false, errorCode: "invalid_request" });
  });
});
