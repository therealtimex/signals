import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
async function seedWorkspace(enabled: boolean) {
  const storageDir = await mkdtemp(join(tmpdir(), "signals-scout-"));
  const workspaceDir = join(storageDir, "working-data", "signals");
  const configPath = join(workspaceDir, scoutConfigRelativePath());
  await mkdir(join(configPath, ".."), { recursive: true });

  const config = readSnowballSeedScoutConfig({
    ...buildSnowballSeedScoutTemplateConfig(),
    enabled,
  });
  const deployment = toDeploymentState(config, {
    deployedAt: "2026-08-25T10:00:00.000Z",
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

  it("clears deployedAt once the scout has been undeployed", async () => {
    const env = await seedWorkspace(false);
    const result = await readSnowballSeedScoutDeployment(env);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Undeploy leaves scout.json on disk so settings survive, but it must not
    // read back as a live deployment.
    expect(result.deployment?.enabled).toBe(false);
    expect(result.deployment?.deployedAt).toBeNull();
    // The saved settings are still there for the dialog to restore.
    expect(result.deployment?.platforms).toEqual(["x", "linkedin"]);
  });
});

describe("saveSnowballSeedScoutSettings", () => {
  it("refuses to provision automation when nothing is deployed", async () => {
    const env = await seedWorkspace(false);
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
