import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { updateContact } from "@/lib/db/queries/contacts";
import { getContentItem } from "@/lib/db/queries/content";
import { getPublishJobById } from "@/lib/db/queries/publish-jobs";
import { getVariantById } from "@/lib/db/queries/variants";
import { graphEdges, publishJobs } from "@/lib/db/schema";
import { proposePersonalityUnbind } from "@/lib/personality/proposal";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { setTargetRepresentation } from "@/lib/personality/use-cases";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { approveVoiceProfile } from "@/lib/writing/voice-profile-store";
import { resetCoreTables } from "@/test/db";
import {
  createPersonalityWritingFixture,
  createReplacementVoiceDraft,
} from "@/test/personality-writing-fixture";

const children = new Set<ChildProcess>();
let storageDir = "";

function sendEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STORAGE_DIR: storageDir,
    RTX_APP_ID: "app-test",
    RTX_API_BASE_URL: "http://127.0.0.1:3001",
    SIGNALS_RTX_WORKSPACE_SLUG: "signals",
  };
}

function fakeRtxFetch(dispatch: "success" | "failure" = "success") {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
      return new Response(JSON.stringify({
        workspace: { slug: "signals", id: "workspace-test-id" },
      }), { status: 200 });
    }
    if (url.endsWith("/cli/create-thread/signals") && init?.method === "POST") {
      return new Response(JSON.stringify({ thread: { slug: "publish-thread" } }), { status: 200 });
    }
    if (url.endsWith("/cli/send-message/signals/publish-thread") && init?.method === "POST") {
      if (dispatch === "failure") {
        return new Response(JSON.stringify({
          success: false,
          terminalDispatchAccepted: false,
          code: "TERMINAL_DISPATCH_REQUIRED",
          error: "No terminal agent configured",
        }), { status: 409 });
      }
      return new Response(JSON.stringify({
        success: true,
        terminalDispatchAccepted: true,
        descriptor: { id: "runtime-race" },
        workspaceSlug: "signals",
        threadSlug: "publish-thread",
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 500 });
  };
}

async function spawnRace(
  mode: "apply" | "target" | "source" | "voice",
  marker: string,
  extraEnv: Record<string, string | undefined> = {},
) {
  const runner = resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
  const script = resolve(process.cwd(), "src/test/personality-writing-race-child.ts");
  const child = spawn(process.execPath, [runner, "--config", "vitest.config.ts", script, mode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITEST: "true",
      SIGNALS_DATA_DIR: process.env.SIGNALS_DATA_DIR,
      RACE_STORAGE_DIR: storageDir,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      children.delete(child);
      resolveExit(code);
    });
  });
  await new Promise<void>((resolveMarker, reject) => {
    const timeout = setTimeout(() => reject(new Error(
      `Race child did not reach ${marker}. stdout=${stdout} stderr=${stderr}`,
    )), 10_000);
    child.stdout!.on("data", () => {
      if (!stdout.includes(marker)) return;
      clearTimeout(timeout);
      resolveMarker();
    });
    child.once("exit", (code) => {
      if (!stdout.includes(marker)) {
        clearTimeout(timeout);
        reject(new Error(`Race child exited before ${marker} (${code}). ${stderr}`));
      }
    });
  });
  return { done, output: () => ({ stdout, stderr }) };
}

function sendFixture(fixture: Awaited<ReturnType<typeof createPersonalityWritingFixture>>) {
  return sendContentToAgent({
    contentItemId: fixture.contentItemId,
    platforms: ["x"],
    targets: [{ targetId: fixture.target.id }],
    text: "ignored",
  }, sendEnv(), fakeRtxFetch());
}

describe.sequential("Personality writing winner-order barriers", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-379-races-"));
  });

  afterEach(async () => {
    for (const child of children) child.kill("SIGTERM");
    children.clear();
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("lets an apply/unbind commit and reconciliation win atomically against G5", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    const proposal = await proposePersonalityUnbind({ kind: "tool" }, fixture.dependencies);
    const race = await spawnRace("apply", "binding-committed", {
      RACE_PROPOSAL_ID: proposal.id,
    });

    const result = await sendFixture(fixture);
    expect(await race.done, race.output().stderr).toBe(0);
    expect(result).toMatchObject({ success: false });
    expect(getContentItem(fixture.contentItemId)?.status).toBe("draft");
    expect(JSON.parse(getVariantById(fixture.variantId)!.metadata ?? "{}").writing.approval)
      .toMatchObject({ state: "revoked", revokedReason: "personality_stale" });
    expect(db.select().from(publishJobs).where(eq(publishJobs.contentItemId, fixture.contentItemId)).all())
      .toHaveLength(0);
  }, 20_000);

  it("does not return a stale materialization edge when concurrent unbind wins", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    const edgeBefore = db.select().from(graphEdges)
      .where(eq(graphEdges.srcId, fixture.variantId))
      .get();
    expect(edgeBefore?.dstId).toBe(fixture.contentItemId);
    const proposal = await proposePersonalityUnbind({ kind: "tool" }, fixture.dependencies);
    const race = await spawnRace("apply", "binding-committed", {
      RACE_PROPOSAL_ID: proposal.id,
    });

    const materialized = await withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({ variantId: fixture.variantId }, guard, tx),
      fixture.dependencies,
    );
    expect(await race.done, race.output().stderr).toBe(0);
    expect(materialized).toMatchObject({
      gateError: { reason: "personality_binding_stale" },
    });
    expect(materialized).not.toMatchObject({ contentItemId: fixture.contentItemId });
    expect(getContentItem(fixture.contentItemId)?.status).toBe("draft");
    expect(JSON.parse(
      db.select().from(graphEdges).where(eq(graphEdges.srcId, fixture.variantId)).get()!.properties
        ?? "{}",
    )).toMatchObject({ revokedReason: "personality_stale" });
  }, 20_000);

  it("lets a target mutation win atomically against G5", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    const race = await spawnRace("target", "target-locked", {
      RACE_TARGET_ID: fixture.target.id,
      RACE_BINDING_ID: fixture.binding.id,
    });

    const result = await sendFixture(fixture);
    expect(await race.done, race.output().stderr).toBe(0);
    expect(result).toMatchObject({ success: false });
    expect(getContentItem(fixture.contentItemId)?.status).toBe("draft");
    expect(db.select().from(publishJobs).where(eq(publishJobs.contentItemId, fixture.contentItemId)).all())
      .toHaveLength(0);
  }, 20_000);

  it("lets a committed source-row write win against G5 on a second SQLite connection", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir);
    const race = await spawnRace("source", "source-locked");

    const result = await sendFixture(fixture);
    expect(await race.done, race.output().stderr).toBe(0);
    expect(result).toMatchObject({
      success: false,
      errorCode: "writing_artifact_stale",
    });
    expect(getContentItem(fixture.contentItemId)?.status).toBe("draft");
    expect(JSON.parse(getVariantById(fixture.variantId)!.metadata ?? "{}").writing.approval)
      .toMatchObject({ state: "revoked", revokedReason: "personality_source_stale" });
    expect(db.select().from(publishJobs).where(eq(publishJobs.contentItemId, fixture.contentItemId)).all())
      .toHaveLength(0);
  }, 20_000);

  it("lets a voice-store supersession win atomically against G5", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const replacement = await createReplacementVoiceDraft({
      ownerContactId: fixture.self.id,
      label: fixture.voiceProfile!.label,
    });
    const race = await spawnRace("voice", "voice-locked", {
      RACE_VOICE_ID: replacement.profile.id,
      RACE_VOICE_VERSION: String(replacement.profile.version),
    });

    const result = await sendFixture(fixture);
    expect(await race.done, race.output().stderr).toBe(0);
    expect(result).toMatchObject({
      success: false,
      errorCode: "writing_artifact_stale",
    });
    expect(getContentItem(fixture.contentItemId)?.status).toBe("draft");
    expect(JSON.parse(getVariantById(fixture.variantId)!.metadata ?? "{}").writing.approval)
      .toMatchObject({ state: "revoked", revokedReason: "personality_source_stale" });
    expect(db.select().from(publishJobs).where(eq(publishJobs.contentItemId, fixture.contentItemId)).all())
      .toHaveLength(0);
  }, 20_000);

  it("preserves the queued snapshot when G5 wins before voice supersession", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const replacement = await createReplacementVoiceDraft({
      ownerContactId: fixture.self.id,
      label: fixture.voiceProfile!.label,
    });
    const queued = await sendFixture(fixture);
    expect(queued.success).toBe(true);
    if (!queued.success) throw new Error(queued.error);
    const before = {
      item: getContentItem(fixture.contentItemId),
      variant: getVariantById(fixture.variantId),
      job: getPublishJobById(queued.jobId),
    };

    await approveVoiceProfile({
      id: replacement.profile.id,
      version: replacement.profile.version,
      evidence: { kind: "ui", route: "/settings/personality" },
    });

    expect({
      item: getContentItem(fixture.contentItemId),
      variant: getVariantById(fixture.variantId),
      job: getPublishJobById(queued.jobId),
    }).toEqual(before);
  }, 20_000);

  it("preserves queued authority snapshots when G5 wins before target and source mutations", async () => {
    const targetFixture = await createPersonalityWritingFixture(storageDir);
    const targetQueued = await sendFixture(targetFixture);
    expect(targetQueued.success).toBe(true);
    if (!targetQueued.success) throw new Error(targetQueued.error);
    const targetBefore = {
      item: getContentItem(targetFixture.contentItemId),
      variant: getVariantById(targetFixture.variantId),
      job: getPublishJobById(targetQueued.jobId),
    };
    await setTargetRepresentation({
      targetId: targetFixture.target.id,
      bindingId: targetFixture.binding.id,
      represents: { kind: "unbound" },
      evidence: { kind: "ui", route: "/settings/personality" },
    }, targetFixture.dependencies);
    expect({
      item: getContentItem(targetFixture.contentItemId),
      variant: getVariantById(targetFixture.variantId),
      job: getPublishJobById(targetQueued.jobId),
    }).toEqual(targetBefore);

    resetCoreTables();
    resetPersonalityStore();
    rmSync(storageDir, { recursive: true, force: true });
    storageDir = mkdtempSync(join(tmpdir(), "signals-379-races-source-"));
    const sourceFixture = await createPersonalityWritingFixture(storageDir);
    const sourceQueued = await sendFixture(sourceFixture);
    expect(sourceQueued.success).toBe(true);
    if (!sourceQueued.success) throw new Error(sourceQueued.error);
    const sourceBefore = {
      item: getContentItem(sourceFixture.contentItemId),
      variant: getVariantById(sourceFixture.variantId),
      job: getPublishJobById(sourceQueued.jobId),
    };
    updateContact(sourceFixture.self.id, { name: "Source changed after G5" });
    expect({
      item: getContentItem(sourceFixture.contentItemId),
      variant: getVariantById(sourceFixture.variantId),
      job: getPublishJobById(sourceQueued.jobId),
    }).toEqual(sourceBefore);
  }, 20_000);
});
