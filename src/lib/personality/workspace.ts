import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  SOCIAL_PERSONALITY_FILES,
  type PersonalityFile,
  type PersonalityIndex,
} from "@/lib/personality/contracts";
import { getSignalsRtxWorkspaceSlug } from "@/lib/rtx/cli-provisioning";
import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { resolveRtxStorageDir } from "@/lib/rtx/storage-path";
import { sha256, sha256Canonical } from "@/lib/writing/hash";

const MANAGED_TARGETS = [...SOCIAL_PERSONALITY_FILES, "AGENTS.md"] as const;
const MANAGED_TARGET_KEYS = new Map(
  MANAGED_TARGETS.map((path) => [path.toLocaleLowerCase("en-US"), path]),
);

export type PersonalityWorkspace = {
  slug: string;
  id: string | null;
  dir: string;
  key: string;
};

export type PersonalityWorkspaceFile = {
  path: PersonalityFile;
  content: string | null;
  fileHash: string | null;
  size: number;
};

function workspaceUnavailable(
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new AgentToolError("WORKSPACE_UNAVAILABLE", message, details);
}

function validationFailure(
  reason: string,
  path: string,
  details: Record<string, unknown> = {},
): never {
  throw new AgentToolError("VALIDATION_ERROR", `Unsafe Personality target: ${path}`, {
    reason,
    path,
    ...details,
  });
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (
    pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !pathFromRoot.startsWith(sep)
  );
}

function assertDirectoryChain(root: string, target: string): void {
  if (!isWithin(root, target)) {
    workspaceUnavailable("Signals workspace directory escapes RealTimeX working-data", {
      root,
      target,
    });
  }
  let cursor = target;
  const chain: string[] = [];
  while (cursor !== root) {
    chain.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) {
      workspaceUnavailable("Could not establish a safe workspace directory chain", {
        root,
        target,
      });
    }
    cursor = parent;
  }
  chain.push(root);
  for (const path of chain.reverse()) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      workspaceUnavailable("Signals workspace directory is unavailable", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      workspaceUnavailable("Signals workspace directory chain is unsafe", {
        path,
        reason: stat.isSymbolicLink() ? "symlink" : "not_directory",
      });
    }
  }
}

function parseWorkspaceIdentity(body: unknown, requestedSlug: string): {
  id: string | null;
  slug: string;
} {
  if (!body || typeof body !== "object") {
    workspaceUnavailable("RealTimeX returned an invalid workspace identity");
  }
  const workspace = (body as { workspace?: unknown }).workspace;
  if (!workspace || typeof workspace !== "object") {
    workspaceUnavailable("RealTimeX returned an invalid workspace identity");
  }
  const rawSlug = (workspace as { slug?: unknown }).slug;
  const rawId = (workspace as { id?: unknown }).id;
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug || slug !== requestedSlug || basename(slug) !== slug) {
    workspaceUnavailable("RealTimeX workspace identity does not match Signals configuration", {
      requestedSlug,
      resolvedSlug: slug || null,
    });
  }
  if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
    workspaceUnavailable("RealTimeX workspace identity is missing its id", { slug });
  }
  return { id: String(rawId), slug };
}

export async function resolvePersonalityWorkspace(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PersonalityWorkspace> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  const storageDir = resolveRtxStorageDir(env);
  const requestedSlug = getSignalsRtxWorkspaceSlug(env);
  if (!appId || !apiBase || !storageDir) {
    workspaceUnavailable("RealTimeX workspace identity is not configured", {
      appId: Boolean(appId),
      apiBase: Boolean(apiBase),
      storageDir: Boolean(storageDir),
    });
  }

  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(
      `${apiBase}/cli/get-workspace/${encodeURIComponent(requestedSlug)}`,
      { method: "GET", headers: { "x-app-id": appId } },
    );
    body = await response.json();
  } catch (error) {
    workspaceUnavailable("Could not resolve the RealTimeX workspace identity", {
      slug: requestedSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    workspaceUnavailable("RealTimeX workspace identity request failed", {
      slug: requestedSlug,
      status: response.status,
    });
  }
  const identity = parseWorkspaceIdentity(body, requestedSlug);
  const workingData = join(storageDir, "working-data");
  if (!existsSync(workingData)) {
    workspaceUnavailable("RealTimeX working-data directory is unavailable", { workingData });
  }
  const workingDataReal = realpathSync(workingData);
  const workspacePath = resolve(workingDataReal, identity.slug);
  assertDirectoryChain(workingDataReal, workspacePath);
  const workspaceReal = realpathSync(workspacePath);
  if (workspaceReal !== workspacePath || !isWithin(workingDataReal, workspaceReal)) {
    workspaceUnavailable("Signals workspace directory is not a safe RealTimeX workspace", {
      workspacePath,
      workspaceReal,
    });
  }
  return {
    slug: identity.slug,
    id: identity.id,
    dir: workspaceReal,
    key: sha256Canonical([identity.slug, workspaceReal]).slice(0, 32),
  };
}

export function assertWorkspaceBindingIdentity(
  workspace: PersonalityWorkspace,
  bindingSet: PersonalityIndex["bindings"][string],
): void {
  if (
    bindingSet.workspaceSlug !== workspace.slug
    || bindingSet.workspaceId !== workspace.id
    || bindingSet.workspaceDir !== workspace.dir
  ) {
    throw new AgentToolError("WORKSPACE_UNAVAILABLE", "Stored Personality workspace identity changed", {
      reason: "workspace_mismatch",
      workspaceKey: workspace.key,
    });
  }
}

export function readPersonalityWorkspaceFiles(
  workspace: PersonalityWorkspace,
): PersonalityWorkspaceFile[] {
  const entries = readdirSync(workspace.dir, { withFileTypes: true });
  for (const entry of entries) {
    const expected = MANAGED_TARGET_KEYS.get(entry.name.toLocaleLowerCase("en-US"));
    if (expected && entry.name !== expected) {
      validationFailure("case_fold_alias", entry.name, { expected });
    }
  }

  return MANAGED_TARGETS.map((path) => {
    const absolutePath = join(workspace.dir, path);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path, content: null, fileHash: null, size: 0 };
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      validationFailure(stat.isSymbolicLink() ? "symlink" : "not_regular_file", path);
    }
    const bytes = readFileSync(absolutePath);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      validationFailure("file_not_utf8", path);
    }
    return {
      path,
      content,
      fileHash: sha256(bytes),
      size: bytes.byteLength,
    };
  });
}

export function inspectClaudeShim(workspace: PersonalityWorkspace): {
  state: "symlink" | "regular_file" | "missing";
  target: string | null;
} {
  const path = join(workspace.dir, "CLAUDE.md");
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "missing", target: null };
    }
    throw error;
  }
  if (!stat.isSymbolicLink()) return { state: "regular_file", target: null };
  return { state: "symlink", target: readlinkSync(path) };
}
