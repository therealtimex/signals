/**
 * Saved Objective briefs: `objectives/<name>.md` in the Signals RealTimeX workspace (#549, §18.6).
 *
 * A brief is operator input, not a Signals projection, so unlike Personality it has no managed
 * blocks, binding or approval lifecycle; operators and agents may edit the files freely, and
 * dispatch snapshots them. It sits next to the workflow brief writer for the same reason. Reads
 * share the Personality reader's safety rules (regular file, no symlink, UTF-8, inside the
 * resolved workspace directory), and writes refuse a symlinked target.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  WorkspaceResourceUnsafeError,
  readSafeRegularFile,
  type WorkspaceResourceFile,
} from "@/lib/personality/workspace-resources";
import {
  OBJECTIVE_BRIEF_MAX_CHARS,
  OBJECTIVE_SLUG_PATTERN,
  parseObjectiveBrief,
} from "@/lib/writing/objective-brief";

export const OBJECTIVES_DIR = "objectives";

export type SavedObjectiveBrief = {
  name: string;
  path: string;
  outcome: string | null;
  fileHash: string;
  updatedAt: number;
};

export function objectiveBriefPath(name: string): string {
  return `${OBJECTIVES_DIR}/${name}.md`;
}

/** `objectives/<name>.md` → `<name>`, or `null` for anything outside that grammar. */
export function parseObjectiveBriefPath(path: string): string | null {
  const match = /^objectives\/([a-z0-9][a-z0-9-]{1,62})\.md$/.exec(path);
  return match ? match[1] : null;
}

/** Names that would shadow the static `/api/objectives/*` routes. */
const RESERVED_OBJECTIVE_NAMES = new Set(["preview", "mentions"]);

export function isObjectiveBriefName(name: string): boolean {
  return OBJECTIVE_SLUG_PATTERN.test(name) && !RESERVED_OBJECTIVE_NAMES.has(name);
}

/**
 * The `objectives/` directory inside the workspace, or `null` when it does not exist yet.
 * Refuses a symlinked or non-directory `objectives` entry.
 */
function objectivesDir(workspace: PersonalityWorkspace): string | null {
  const dir = join(workspace.dir, OBJECTIVES_DIR);
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new WorkspaceResourceUnsafeError(stat.isSymbolicLink() ? "symlink" : "not_directory", OBJECTIVES_DIR);
  }
  return dir;
}

export function readSavedObjectiveBrief(
  workspace: PersonalityWorkspace,
  name: string,
): WorkspaceResourceFile | null {
  if (!isObjectiveBriefName(name)) {
    throw new WorkspaceResourceUnsafeError("invalid_name", objectiveBriefPath(name));
  }
  const dir = objectivesDir(workspace);
  if (!dir) return null;
  const file = readSafeRegularFile(join(dir, `${name}.md`), objectiveBriefPath(name));
  if (file && file.content.length > OBJECTIVE_BRIEF_MAX_CHARS) {
    throw new WorkspaceResourceUnsafeError("brief_too_large", file.path);
  }
  return file;
}

/** Saved briefs, newest first. Unsafe or oversized entries are skipped rather than listed. */
export function listSavedObjectiveBriefs(workspace: PersonalityWorkspace): SavedObjectiveBrief[] {
  const dir = objectivesDir(workspace);
  if (!dir) return [];
  const briefs: SavedObjectiveBrief[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const match = /^([a-z0-9][a-z0-9-]{1,62})\.md$/.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    let file: WorkspaceResourceFile | null;
    try {
      file = readSavedObjectiveBrief(workspace, match[1]);
    } catch {
      continue;
    }
    if (!file) continue;
    briefs.push({
      name: match[1],
      path: objectiveBriefPath(match[1]),
      outcome: parseObjectiveBrief(file.content).outcome,
      fileHash: file.fileHash,
      updatedAt: Math.floor(file.mtimeMs / 1000),
    });
  }
  return briefs.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

export class ObjectiveBriefExistsError extends AgentToolError {
  constructor(path: string) {
    super("CONFLICT", `A saved brief already exists at ${path}`, { reason: "objective_exists", path });
  }
}

/**
 * Write `objectives/<name>.md`.
 *
 * Without `overwrite` the file is created exclusively (`O_EXCL`), so a concurrent writer or an
 * existing brief yields `ObjectiveBriefExistsError` instead of a silent replacement. `O_NOFOLLOW`
 * refuses a symlink planted at the target between the checks and the write.
 */
export function writeSavedObjectiveBrief(
  workspace: PersonalityWorkspace,
  input: { name: string; text: string; overwrite?: boolean },
): SavedObjectiveBrief {
  if (!isObjectiveBriefName(input.name)) {
    throw new WorkspaceResourceUnsafeError("invalid_name", objectiveBriefPath(input.name));
  }
  if (input.text.length > OBJECTIVE_BRIEF_MAX_CHARS) {
    throw new WorkspaceResourceUnsafeError("brief_too_large", objectiveBriefPath(input.name));
  }
  let dir = objectivesDir(workspace);
  if (!dir) {
    dir = join(workspace.dir, OBJECTIVES_DIR);
    try {
      // Non-recursive: the workspace directory itself was established by the resolver.
      mkdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    dir = objectivesDir(workspace);
    if (!dir) throw new WorkspaceResourceUnsafeError("not_directory", OBJECTIVES_DIR);
  }
  const path = objectiveBriefPath(input.name);
  const absolutePath = join(dir, `${input.name}.md`);
  if (input.overwrite) {
    // Validates an existing target is a safe regular file before truncating it.
    readSafeRegularFile(absolutePath, path);
  }
  const flags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_NOFOLLOW
    | (input.overwrite ? constants.O_TRUNC : constants.O_EXCL);
  let fd: number;
  try {
    fd = openSync(absolutePath, flags, 0o644);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new ObjectiveBriefExistsError(path);
    if (code === "ELOOP") throw new WorkspaceResourceUnsafeError("symlink", path);
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) throw new WorkspaceResourceUnsafeError("not_regular_file", path);
    writeSync(fd, input.text, 0, "utf8");
  } finally {
    closeSync(fd);
  }
  const written = readSavedObjectiveBrief(workspace, input.name)!;
  return {
    name: input.name,
    path,
    outcome: parseObjectiveBrief(written.content).outcome,
    fileHash: written.fileHash,
    updatedAt: Math.floor(written.mtimeMs / 1000),
  };
}
