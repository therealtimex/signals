/**
 * Read-only workspace resources for the account objective (#549, spec §18.5).
 *
 * Same safety rules as `readPersonalityWorkspaceFiles`: everything is resolved inside the Signals
 * RealTimeX workspace directory that `resolvePersonalityWorkspace` established, symlinks and
 * non-regular files are refused, case-fold aliases are refused, and content must be UTF-8.
 * PRODUCTS.md is read here rather than through #530's future catalog so the run objective can
 * reference an offering today; this reader becomes that catalog's consumer. Nothing here writes:
 * saved Objective briefs are operator files, not Personality, and live in
 * `@/lib/rtx/objective-brief-files`.
 */

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import { sha256 } from "@/lib/writing/hash";
import {
  OBJECTIVE_MENTION_FILES,
  OBJECTIVE_SLUG_PATTERN,
  type ObjectiveMentionFile,
} from "@/lib/writing/objective-brief";

export const WORKSPACE_RESOURCE_MAX_BYTES = 256 * 1024;
export const OBJECTIVE_MENTION_EXCERPT_MAX_CHARS = 8 * 1024;

const RESOURCE_KEYS = new Map(
  OBJECTIVE_MENTION_FILES.map((path) => [path.toLocaleLowerCase("en-US"), path]),
);

export type WorkspaceResourceFile = {
  path: string;
  content: string;
  fileHash: string;
  size: number;
  mtimeMs: number;
};

export class WorkspaceResourceUnsafeError extends AgentToolError {
  constructor(reason: string, path: string) {
    super("VALIDATION_ERROR", `Unsafe workspace resource: ${path}`, { reason, path });
  }
}

/** Read a regular, non-symlinked UTF-8 file of at most 256 KiB; `null` when absent. */
export function readSafeRegularFile(absolutePath: string, displayPath: string): WorkspaceResourceFile | null {
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new WorkspaceResourceUnsafeError(stat.isSymbolicLink() ? "symlink" : "not_regular_file", displayPath);
  }
  if (stat.size > WORKSPACE_RESOURCE_MAX_BYTES) {
    throw new WorkspaceResourceUnsafeError("file_too_large", displayPath);
  }
  const bytes = readFileSync(absolutePath);
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new WorkspaceResourceUnsafeError("file_not_utf8", displayPath);
  }
  return { path: displayPath, content, fileHash: sha256(bytes), size: bytes.byteLength, mtimeMs: stat.mtimeMs };
}

function assertNoCaseFoldAlias(dir: string, expected: Map<string, string>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const canonical = expected.get(entry.name.toLocaleLowerCase("en-US"));
    if (canonical && entry.name !== canonical) {
      throw new WorkspaceResourceUnsafeError("case_fold_alias", entry.name);
    }
  }
}

/**
 * Read one allowlisted workspace file. `null` when it does not exist.
 *
 * Throws `WorkspaceResourceUnsafeError` for a symlink, a non-regular file, a case-fold alias, a
 * non-UTF-8 file or one over 256 KiB, so a caller never mistakes an unsafe file for an absent one.
 */
export function readWorkspaceResource(
  workspace: PersonalityWorkspace,
  path: ObjectiveMentionFile,
): WorkspaceResourceFile | null {
  if (!RESOURCE_KEYS.has(path.toLocaleLowerCase("en-US")) || RESOURCE_KEYS.get(path.toLocaleLowerCase("en-US")) !== path) {
    throw new WorkspaceResourceUnsafeError("not_allowlisted", path);
  }
  assertNoCaseFoldAlias(workspace.dir, RESOURCE_KEYS);
  return readSafeRegularFile(join(workspace.dir, path), path);
}

/* ------------------------------------------------------------------------------------------------
 * PRODUCTS.md entries
 * ---------------------------------------------------------------------------------------------- */

export type ProductEntry = {
  slug: string;
  name: string;
  oneLiner: string | null;
  proofPointCount: number;
  /** The entry's `## ` section as written, bounded to 8 KiB for display and the brief. */
  excerpt: string;
  /**
   * sha256 of the whole section before the excerpt is bounded: the entry's source identity, so an
   * edit past the display cutoff (where proof points often sit) still reads as a change.
   */
  sectionHash: string;
};

const SLUG_LINE = /^\s{0,3}[-*+]\s+\*\*Slug:\*\*\s*`([^`]+)`\s*$/i;
const ONE_LINER_LINE = /^\s{0,3}[-*+]\s+\*\*One-Liner:\*\*\s*(.+?)\s*$/i;

export function boundExcerpt(text: string): string {
  return text.length > OBJECTIVE_MENTION_EXCERPT_MAX_CHARS
    ? `${text.slice(0, OBJECTIVE_MENTION_EXCERPT_MAX_CHARS - 1)}…`
    : text;
}

function countProofPoints(lines: string[]): number {
  let inProof = false;
  let fence = false;
  let count = 0;
  for (const line of lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^\s{0,3}#{3,6}\s+(.*)$/.exec(line);
    if (heading) {
      inProof = /proof/i.test(heading[1]);
      continue;
    }
    if (inProof && /^(?:[-*+]|\d+[.)])\s+\S/.test(line)) count += 1;
  }
  return count;
}

/**
 * Parse PRODUCTS.md into entries.
 *
 * An entry is a `## ` section with a `- **Slug:** \`<slug>\`` line (the convention #530 Phase 1
 * declared). The slug is the reference, not the heading, because headings carry numbering and are
 * reworded. Sections without a valid slug are not entries; the first section wins for a slug.
 */
export function parseProductsCatalog(content: string): ProductEntry[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const sectionsFound: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  let fence = false;
  for (const line of lines) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) fence = !fence;
    const top = !fence ? /^#{1,2}\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (top) {
      current = line.startsWith("## ") ? { heading: top[1], lines: [line] } : null;
      if (current) sectionsFound.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  const entries: ProductEntry[] = [];
  const seen = new Set<string>();
  for (const section of sectionsFound) {
    const slug = section.lines.map((line) => SLUG_LINE.exec(line)?.[1]?.trim()).find(Boolean);
    if (!slug || !OBJECTIVE_SLUG_PATTERN.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const oneLiner = section.lines.map((line) => ONE_LINER_LINE.exec(line)?.[1]).find(Boolean) ?? null;
    const body = section.lines.join("\n").replace(/\n+(?:-{3,}|\*{3,}|_{3,})?\s*$/, "").trimEnd();
    entries.push({
      slug,
      name: section.heading.replace(/^\d+[.)]\s+/, "").trim() || slug,
      oneLiner: oneLiner ? oneLiner.slice(0, 300) : null,
      proofPointCount: countProofPoints(section.lines),
      excerpt: boundExcerpt(body),
      sectionHash: sha256(body),
    });
  }
  return entries;
}
