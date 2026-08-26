import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deploySnowballSeedScout,
  readSnowballSeedScoutDeployment,
  saveSnowballSeedScoutSettings,
} from "@/lib/rtx/deploy-snowball-seed-scout";
import {
  buildSnowballSeedScoutDeployConfig,
  buildSnowballSeedScoutTemplateConfig,
  readSnowballSeedScoutConfig,
  scoutConfigRelativePath,
  toDeploymentState,
} from "@/lib/workflows/snowball-seed-scout";

vi.mock("@/lib/rtx/cli-provisioning", () => ({
  getSignalsRtxWorkspaceSlug: () => "signals",
  resolveSignalsRtxWorkspaceSlug: vi.fn(async () => "signals"),
  ensureRtxWorkspace: vi.fn(async () => "signals"),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** Writes a scout.json into a throwaway RTX storage dir and returns the env pointing at it. */
async function seedWorkspace(enabled: boolean, deployedAt: string | null = "2026-08-25T10:00:00.000Z") {
  const storageDir = await mkdtemp(join(tmpdir(), "signals-scout-"));
  const workspaceDir = join(storageDir, "working-data", "signals");
  const configPath = join(workspaceDir, scoutConfigRelativePath());
  await mkdir(join(configPath, ".."), { recursive: true });

  const config = readSnowballSeedScoutConfig({
    ...buildSnowballSeedScoutTemplateConfig(),
    enabled,
  });
  const deployment = toDeploymentState(config, {
    deployedAt,
    templateId: "tpl-1",
  });
  await writeFile(configPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  return { STORAGE_DIR: storageDir, SIGNALS_RTX_WORKSPACE_SLUG: "signals" };
}

describe("readSnowballSeedScoutDeployment", () => {
  it("reports an enabled scout as deployed", async () => {
    const env = await seedWorkspace(true);
    const result = await readSnowballSeedScoutDeployment(env);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.deployment?.deployedAt).toBe("2026-08-25T10:00:00.000Z");
    expect(result.deployment?.enabled).toBe(true);
  });

  it("keeps a paused scout deployed", async () => {
    // The UI offers `enabled: false` as "pause without removing deploy files",
    // so pausing must not make the deployment look gone.
    const env = await seedWorkspace(false);
    const result = await readSnowballSeedScoutDeployment(env);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.deployment?.enabled).toBe(false);
    expect(result.deployment?.deployedAt).toBe("2026-08-25T10:00:00.000Z");
    expect(result.deployment?.platforms).toEqual(["x", "linkedin"]);
  });

  it("reports an undeployed scout as not deployed", async () => {
    // Undeploy persists deployedAt: null while leaving settings on disk.
    const env = await seedWorkspace(false, null);
    const result = await readSnowballSeedScoutDeployment(env);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.deployment?.deployedAt).toBeNull();
    expect(result.deployment?.platforms).toEqual(["x", "linkedin"]);
  });
});

describe("deploySnowballSeedScout heartbeat guard", () => {
  it("writes nothing when HEARTBEAT.md uses a populated inline task array", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "signals-scout-guard-"));
    const workspaceDir = join(storageDir, "working-data", "signals");
    await mkdir(workspaceDir, { recursive: true });

    const heartbeat = `# Heartbeat

tasks: [{ name: morning-brief, agent: claude, prompt: keep-me, interval: 24h }]
`;
    await writeFile(join(workspaceDir, "HEARTBEAT.md"), heartbeat, "utf8");

    const scoutConfig = readSnowballSeedScoutConfig(
      buildSnowballSeedScoutTemplateConfig(),
    );
    const result = await deploySnowballSeedScout(
      { templateId: "tpl-1", config: buildSnowballSeedScoutDeployConfig(scoutConfig) },
      { STORAGE_DIR: storageDir, SIGNALS_RTX_WORKSPACE_SLUG: "signals" },
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorCode).toBe("unsupported_heartbeat");
    expect(result.error).toContain("inline list");

    // The rejection must precede every write: no scripts, no scout.json, and the
    // user's heartbeat byte-for-byte untouched.
    expect(await readFile(join(workspaceDir, "HEARTBEAT.md"), "utf8")).toBe(heartbeat);
    expect(await readdir(workspaceDir)).toEqual(["HEARTBEAT.md"]);
  });
});

describe("saveSnowballSeedScoutSettings", () => {
  it("saves settings for a paused-but-deployed scout", async () => {
    const env = await seedWorkspace(false);
    const scoutConfig = readSnowballSeedScoutConfig(
      buildSnowballSeedScoutTemplateConfig(),
    );

    // Toggling the pause switch must not lock the user out of the settings path
    // that would turn it back on.
    const result = await saveSnowballSeedScoutSettings(
      {
        templateId: "tpl-1",
        config: buildSnowballSeedScoutDeployConfig(scoutConfig),
      },
      env,
    );

    expect(result.success).toBe(true);
  });

  it("refuses to provision automation when nothing is deployed", async () => {
    const env = await seedWorkspace(false, null);
    const scoutConfig = readSnowballSeedScoutConfig(
      buildSnowballSeedScoutTemplateConfig(),
    );

    const result = await saveSnowballSeedScoutSettings(
      {
        templateId: "tpl-1",
        config: buildSnowballSeedScoutDeployConfig(scoutConfig),
      },
      env,
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("is not deployed");
  });
});
