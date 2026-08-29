import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { __voiceStoreTestHooks, approveVoiceProfile, getVoiceProfile, listVoiceProfiles, upsertVoiceProfile } from "@/lib/writing/voice-profile-store";

function profile(samples = 3, id = "vp_profile1") {
  return {
    schemaVersion: 1,
    id,
    label: "Primary",
    ownerContactId: null,
    platforms: ["x"],
    samples: Array.from({ length: samples }, (_, index) => ({
      id: `vs_sample${index}`,
      text: `My original line ${index}`,
      source: { kind: "pasted", pastedAt: 10 + index },
      authorship: "self",
      approved: true,
    })),
    fingerprint: {
      sentenceLength: { medianWords: 4, range: [2, 8] },
      openers: [], closers: [], punctuation: [],
      vocabulary: { keep: [], avoid: [] }, formats: [],
      emoji: "rare", hashtags: "none", protectedQuirks: ["fragments"], taboo: [],
    },
    signatureLines: [{ text: "original line", sampleId: "vs_sample0" }],
    derivedBy: { method: "manual", at: 20 },
  };
}

const evidence = { kind: "api" as const, caller: "voice-test" };

function runVoiceChild(operation: Record<string, unknown>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const runner = resolve(process.cwd(), "node_modules/vite-node/vite-node.mjs");
  const config = resolve(process.cwd(), "vitest.config.ts");
  const script = resolve(process.cwd(), "src/test/voice-profile-store-child.ts");
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, [runner, "--config", config, script, JSON.stringify(operation)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolveChild({ code, stdout, stderr }));
  });
}

describe("voice profile store", () => {
  beforeEach(() => resetCoreTables());

  it("keeps immutable versions and projects atomic supersession", async () => {
    const first = await upsertVoiceProfile(profile());
    expect(first.profile.status).toBe("draft");
    const approved = await approveVoiceProfile({ id: first.profile.id, version: 1, evidence });
    expect(approved.status).toBe("approved");

    const second = await upsertVoiceProfile({ ...profile(), brand: { notes: "revision" } });
    expect(second.profile.version).toBe(2);
    await approveVoiceProfile({ id: second.profile.id, version: 2, evidence });
    expect(getVoiceProfile(first.profile.id, 1).profile).toMatchObject({ status: "superseded", supersededBy: { version: 2 } });
    expect(getVoiceProfile(first.profile.id, 2).profile.status).toBe("approved");
  });

  it("resolves the active revision through the owner and label slot", async () => {
    const first = await upsertVoiceProfile(profile(3, "vp_profile1"));
    await approveVoiceProfile({ id: first.profile.id, version: 1, evidence });
    const replacement = await upsertVoiceProfile({
      ...profile(3, "vp_profile2"),
      brand: { notes: "replacement" },
    });
    await approveVoiceProfile({ id: replacement.profile.id, version: 1, evidence });

    expect(getVoiceProfile(first.profile.id, 1)).toMatchObject({
      profile: { status: "superseded" },
      active: { version: 1 },
    });
  });

  it("rejects insufficient samples and invented signature lines", async () => {
    const tooFew = await upsertVoiceProfile(profile(2));
    await expect(approveVoiceProfile({ id: tooFew.profile.id, version: 1, evidence })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const bad = await upsertVoiceProfile({ ...profile(3, "vp_profile2"), signatureLines: [{ text: "not present", sampleId: "vs_sample0" }] });
    await expect(approveVoiceProfile({ id: bad.profile.id, version: 1, evidence })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("serializes concurrent same and different content registrations", async () => {
    const same = await Promise.all([upsertVoiceProfile(profile()), upsertVoiceProfile(profile())]);
    expect(new Set(same.map((entry) => entry.profile.version))).toEqual(new Set([1]));
    await Promise.all([
      upsertVoiceProfile({ ...profile(), brand: { notes: "A" } }),
      upsertVoiceProfile({ ...profile(), brand: { notes: "B" } }),
    ]);
    expect(listVoiceProfiles().map((entry) => entry.version).sort()).toEqual([1, 2, 3]);
  });

  it("serializes coalescing and independent registrations across processes", async () => {
    const [sameA, sameB, independent] = await Promise.all([
      runVoiceChild({ mode: "upsert", profile: profile(3, "vp_profile1") }),
      runVoiceChild({ mode: "upsert", profile: profile(3, "vp_profile1") }),
      runVoiceChild({ mode: "upsert", profile: profile(3, "vp_profile2") }),
    ]);
    for (const result of [sameA, sameB, independent]) {
      expect(result, result.stderr).toMatchObject({ code: 0 });
    }
    expect(listVoiceProfiles().map((entry) => `${entry.id}:${entry.version}`).sort()).toEqual([
      "vp_profile1:1",
      "vp_profile2:1",
    ]);

    const [revisionA, revisionB] = await Promise.all([
      runVoiceChild({ mode: "upsert", profile: { ...profile(), brand: { notes: "A" } } }),
      runVoiceChild({ mode: "upsert", profile: { ...profile(), brand: { notes: "B" } } }),
    ]);
    expect(revisionA, revisionA.stderr).toMatchObject({ code: 0 });
    expect(revisionB, revisionB.stderr).toMatchObject({ code: 0 });
    expect(listVoiceProfiles().filter((entry) => entry.id === "vp_profile1").map((entry) => entry.version).sort()).toEqual([1, 2, 3]);
  });

  it("coalesces against any immutable version, not only the latest", async () => {
    const first = await upsertVoiceProfile(profile());
    await upsertVoiceProfile({ ...profile(), brand: { notes: "revision" } });
    const replay = await upsertVoiceProfile(profile());

    expect(replay).toMatchObject({ created: false, profile: { version: first.profile.version } });
    expect(listVoiceProfiles()).toHaveLength(2);
  });

  it("reuses a matching orphan after a crash between install and index commit", async () => {
    await upsertVoiceProfile(profile());
    let orphanPath = "";
    __voiceStoreTestHooks.afterInstall = (path) => {
      orphanPath = path;
      delete __voiceStoreTestHooks.afterInstall;
      throw new Error("injected crash after immutable install");
    };
    const revision = { ...profile(), brand: { notes: "orphaned revision" } };
    await expect(upsertVoiceProfile(revision)).rejects.toThrow(/injected crash/);
    const bytes = readFileSync(orphanPath);

    const recovered = await upsertVoiceProfile(revision);
    expect(recovered).toMatchObject({ created: true, profile: { version: 2 } });
    expect(readFileSync(orphanPath)).toEqual(bytes);
  });

  it("recovers a stale cross-process lock and matching orphan after process death", async () => {
    await upsertVoiceProfile(profile());
    const revision = { ...profile(), brand: { notes: "cross-process orphan" } };
    const crashed = await runVoiceChild({ mode: "crash_after_install", profile: revision });
    expect(crashed.code, crashed.stderr).toBe(86);

    const recovered = await upsertVoiceProfile(revision);
    expect(recovered).toMatchObject({ created: true, profile: { version: 2 } });
    expect(listVoiceProfiles().map((entry) => entry.version).sort()).toEqual([1, 2]);
  });

  it("ignores attempted lifecycle and source-hash injection", async () => {
    const injected = profile() as ReturnType<typeof profile> & { status?: string; hash?: string };
    injected.status = "approved";
    injected.hash = "agent-hash";
    (injected.samples[0].source as Record<string, unknown>).sha256 = "agent-sample-hash";
    const result = await upsertVoiceProfile(injected);

    expect(result.profile.status).toBe("draft");
    expect(result.profile.hash).not.toBe("agent-hash");
    expect(result.profile.samples[0].source).toMatchObject({ sha256: expect.not.stringMatching("agent-sample-hash") });
  });
});
