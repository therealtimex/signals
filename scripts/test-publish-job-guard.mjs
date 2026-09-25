#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { verifyPublishJob } = require("../.claude/skills/signals-publish/scripts/publish-job-guard.cjs");

const baseUrl = "http://127.0.0.1:3010";
const payload = {
  jobId: "job-1",
  contentItemId: "item-1",
  targetId: "target-1",
  expectedHandle: "@author",
  text: "Research update",
  mediaPaths: [["/tmp/chart.jpg"]],
};
const job = {
  id: payload.jobId,
  contentItemId: payload.contentItemId,
  status: "publishing",
  payload: {
    text: payload.text,
    platforms: ["x"],
    mediaAssetIds: ["chart-1"],
  },
  targets: [{ platform: "x", targetId: payload.targetId, expectedHandle: payload.expectedHandle, status: "publishing" }],
};
const item = { id: payload.contentItemId, status: "publishing", platformTarget: "x" };

function fakeFetch({ jobValue = job, itemValue = item, assets = [{ id: "chart-1" }] } = {}) {
  return async (input) => {
    const path = new URL(input).pathname;
    if (path === `/api/content/publish-jobs/${payload.jobId}`) {
      return Response.json({ success: Boolean(jobValue), job: jobValue }, { status: jobValue ? 200 : 404 });
    }
    if (path === `/api/content/${payload.contentItemId}`) {
      return Response.json({ item: itemValue }, { status: itemValue ? 200 : 404 });
    }
    if (path === "/api/media") return Response.json({ assets });
    throw new Error(`Unexpected URL: ${input}`);
  };
}

async function rejects(message, changes = {}) {
  await assert.rejects(
    verifyPublishJob({ payload: { ...payload, ...changes.payload }, platform: "x", baseUrl, fetchImpl: fakeFetch(changes) }),
    (error) => error?.message?.includes(message)
  );
}

assert.deepEqual(
  await verifyPublishJob({ payload, platform: "x", baseUrl, fetchImpl: fakeFetch() }),
  { jobId: "job-1", contentItemId: "item-1", targetId: "target-1" }
);
await rejects("jobId and payload.contentItemId", { payload: { jobId: undefined } });
await rejects("Signals returned HTTP 404", { jobValue: null });
await rejects("Signals returned HTTP 404", { itemValue: null });
await rejects("browser payload differs from the queued post text", { payload: { text: "Changed text" } });
await rejects("browser payload differs from the queued source post", { payload: { sourcePostUrl: "https://x.com/a/status/1" } });
await rejects("browser payload omits queued media", { payload: { mediaPaths: [] } });
await rejects("queued media is not attached", { assets: [] });
await rejects("requested platform target is not actively publishing", { payload: { targetId: "another-target" } });
await rejects("job is not actively publishing", { jobValue: { ...job, status: "completed" } });
await rejects("Content item is not publishing", { itemValue: { ...item, status: "draft" } });
await assert.rejects(
  verifyPublishJob({ payload, platform: "x", baseUrl: "https://example.com", fetchImpl: fakeFetch() }),
  (error) => error?.message?.includes("local HTTP origin")
);

const workDir = mkdtempSync(join(tmpdir(), "signals-publish-guard-test-"));
try {
  const payloadPath = join(workDir, "untracked-post.json");
  const browserStatePath = join(workDir, "browser-state.json");
  writeFileSync(payloadPath, JSON.stringify({ text: "Untracked post" }));
  for (const platform of ["x", "facebook"]) {
    const script = join(import.meta.dirname, "..", ".claude", "skills", "signals-publish", "scripts", `${platform}-publish.cjs`);
    const result = spawnSync(process.execPath, [script, "--port", "9222", "--payload", payloadPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_BIN: process.execPath,
        AGENT_BROWSER_BIN_ARGS: join(import.meta.dirname, "fixtures", "fake-agent-browser.cjs"),
        FAKE_AB_STATE_FILE: browserStatePath,
        SIGNALS_BASE_URL: baseUrl,
      },
    });
    assert.equal(result.status, 1, `${platform} must reject an untracked live post`);
    assert.match(result.stdout, /Signals publish preflight: payload\.jobId and payload\.contentItemId are required/);
    assert.equal(existsSync(browserStatePath), false, `${platform} must not touch the browser`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log("publish-job guard: OK");
