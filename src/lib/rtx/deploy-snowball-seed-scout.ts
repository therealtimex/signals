import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvLike } from "@/lib/rtx/env";
import { ensureRtxWorkspace, getSignalsRtxWorkspaceSlug, resolveSignalsRtxWorkspaceSlug } from "@/lib/rtx/cli-provisioning";
import {
  defaultHeartbeatSkeleton,
  HEARTBEAT_FILENAME,
  upsertHeartbeatShellTask,
  type HeartbeatShellTask,
} from "@/lib/rtx/heartbeat-task-block";
import { resolveRtxWorkspaceWorkingDir } from "@/lib/rtx/storage-path";
import { writeRtxWorkspaceBriefFile } from "@/lib/rtx/workspace-brief-files";
import {
  formatHeartbeatInterval,
  readSnowballSeedScoutConfig,
  scoutConfigRelativePath,
  scoutShellCommandRelative,
  SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME,
  SNOWBALL_SEED_SCOUT_WORKSPACE_REL_DIR,
  toDeploymentState,
  type SnowballSeedScoutConfig,
} from "@/lib/workflows/snowball-seed-scout";

const SCOUT_SCRIPT_FILES = [
  "scout.sh",
  "lib/browser.sh",
  "lib/enqueue.sh",
  "lib/extract.sh",
  "lib/copy-link-harvest.sh",
  "lib/resolve.py",
] as const;

export type DeploySnowballSeedScoutResult =
  | {
      success: true;
      workspaceSlug: string;
      heartbeatPath: string;
      scoutConfigPath: string;
      deployment: ReturnType<typeof toDeploymentState>;
    }
  | { success: false; error: string; errorCode?: "not_deployed" };

async function readWorkspaceFile(
  workspaceDir: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(join(workspaceDir, relativePath), "utf8");
  } catch {
    return null;
  }
}

async function copyBundledScoutScripts(
  workspaceSlug: string,
  env: EnvLike,
): Promise<{ success: true } | { success: false; error: string }> {
  const sourceRoot =
    env.SIGNALS_REPO_ROOT?.trim() ||
    join(process.cwd(), "scripts", "snowball-seed-scout");

  for (const relativePath of SCOUT_SCRIPT_FILES) {
    let source: string;
    try {
      source = await readFile(join(sourceRoot, relativePath), "utf8");
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `Missing scout script ${relativePath}: ${error.message}`
            : `Missing scout script ${relativePath}`,
      };
    }

    const writeResult = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      `${SNOWBALL_SEED_SCOUT_WORKSPACE_REL_DIR}/${relativePath}`,
      source,
      env,
    );

    if (!writeResult.success) {
      return { success: false, error: writeResult.error };
    }
  }

  return { success: true };
}

function buildHeartbeatTask(config: SnowballSeedScoutConfig): HeartbeatShellTask {
  return {
    name: SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME,
    executor: "shell",
    command: scoutShellCommandRelative(),
    interval: config.enabled
      ? formatHeartbeatInterval(config.heartbeatIntervalHours)
      : "disabled",
    timeout: 900,
  };
}

export async function deploySnowballSeedScout(
  input: {
    templateId: string;
    config: Record<string, unknown>;
    preserveDeployedAt?: string | null;
  },
  env: EnvLike = process.env,
): Promise<DeploySnowballSeedScoutResult> {
  const scoutConfig = readSnowballSeedScoutConfig(input.config);
  const preferredSlug = getSignalsRtxWorkspaceSlug(env);

  let workspaceSlug: string;
  try {
    workspaceSlug = await ensureRtxWorkspace(preferredSlug, "Signals", env);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to ensure RealTimeX workspace",
    };
  }

  const workspaceDir = resolveRtxWorkspaceWorkingDir(workspaceSlug, env);
  if (!workspaceDir) {
    return {
      success: false,
      error:
        "Cannot resolve RealTimeX workspace directory. Set STORAGE_DIR or REALTIMEX_USER_DATA_PATH.",
    };
  }

  const scriptCopy = await copyBundledScoutScripts(workspaceSlug, env);
  if (!scriptCopy.success) {
    return scriptCopy;
  }

  const deployment = toDeploymentState(scoutConfig, {
    deployedAt: input.preserveDeployedAt ?? new Date().toISOString(),
    templateId: input.templateId,
  });

  const scoutConfigWrite = await writeRtxWorkspaceBriefFile(
    workspaceSlug,
    scoutConfigRelativePath(),
    `${JSON.stringify(deployment, null, 2)}\n`,
    env,
  );
  if (!scoutConfigWrite.success) {
    return { success: false, error: scoutConfigWrite.error };
  }

  const existingHeartbeat =
    (await readWorkspaceFile(workspaceDir, HEARTBEAT_FILENAME)) ??
    defaultHeartbeatSkeleton();
  const nextHeartbeat = upsertHeartbeatShellTask(
    existingHeartbeat,
    buildHeartbeatTask(scoutConfig),
  );

  const heartbeatWrite = await writeRtxWorkspaceBriefFile(
    workspaceSlug,
    HEARTBEAT_FILENAME,
    nextHeartbeat,
    env,
  );
  if (!heartbeatWrite.success) {
    return { success: false, error: heartbeatWrite.error };
  }

  return {
    success: true,
    workspaceSlug,
    heartbeatPath: heartbeatWrite.absolutePath,
    scoutConfigPath: scoutConfigWrite.absolutePath,
    deployment,
  };
}

export async function undeploySnowballSeedScout(
  input: {
    config: Record<string, unknown>;
  },
  env: EnvLike = process.env,
): Promise<DeploySnowballSeedScoutResult> {
  const scoutConfig = readSnowballSeedScoutConfig({
    ...input.config,
    enabled: false,
  });
  return deploySnowballSeedScout(
    {
      templateId:
        typeof input.config.templateId === "string"
          ? input.config.templateId
          : "",
      config: scoutConfig as unknown as Record<string, unknown>,
    },
    env,
  );
}

export async function readSnowballSeedScoutDeployment(
  env: EnvLike = process.env,
): Promise<
  | { success: true; deployment: ReturnType<typeof toDeploymentState> | null }
  | { success: false; error: string }
> {
  let workspaceSlug = getSignalsRtxWorkspaceSlug(env);
  try {
    workspaceSlug = await resolveSignalsRtxWorkspaceSlug(env);
  } catch {
    // Fall back to the configured slug when RTX CLI resolution is unavailable.
  }

  const workspaceDir = resolveRtxWorkspaceWorkingDir(workspaceSlug, env);
  if (!workspaceDir) {
    return {
      success: false,
      error: "Cannot resolve RealTimeX workspace directory.",
    };
  }

  const raw = await readWorkspaceFile(workspaceDir, scoutConfigRelativePath());
  if (!raw) {
    return { success: true, deployment: null };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = readSnowballSeedScoutConfig(parsed);
    return {
      success: true,
      deployment: toDeploymentState(config, {
        // Undeploy rewrites scout.json with `enabled: false` rather than deleting
        // it, so the saved settings survive. Such a config is not a live
        // deployment: clear `deployedAt` so dialog reloads, settings saves, and
        // enqueue requests all honor the undeploy.
        deployedAt:
          config.enabled && typeof parsed.deployedAt === "string"
            ? parsed.deployedAt
            : null,
        templateId:
          typeof parsed.templateId === "string" ? parsed.templateId : null,
      }),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to parse scout.json",
    };
  }
}

export async function saveSnowballSeedScoutSettings(
  input: {
    templateId: string;
    config: Record<string, unknown>;
  },
  env: EnvLike = process.env,
): Promise<DeploySnowballSeedScoutResult> {
  const existing = await readSnowballSeedScoutDeployment(env);
  if (!existing.success) {
    return existing;
  }

  // Saving settings updates an existing deployment; it must never be the path
  // that first provisions workspace scripts and a heartbeat task. Only Deploy
  // creates automation.
  if (!existing.deployment?.deployedAt) {
    return {
      success: false,
      error: "Snowball Seed Scout is not deployed. Deploy it before saving settings.",
      errorCode: "not_deployed",
    };
  }

  return deploySnowballSeedScout(
    {
      templateId: input.templateId || existing.deployment?.templateId || "",
      config: input.config,
      preserveDeployedAt: existing.deployment?.deployedAt ?? null,
    },
    env,
  );
}
