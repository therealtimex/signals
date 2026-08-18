import { unzipSync, type UnzipFileInfo } from "fflate";

/**
 * Locate and extract the data slices we import from an official X data
 * archive zip (`twitter-YYYY-MM-DD-….zip`). Only matched `data/*.js` entries
 * are decompressed — media and everything else is skipped after metadata
 * inspection to avoid zip-bomb allocation (same approach as the LinkedIn
 * zip import).
 */

/** Max decompressed size per data file — tweets.js can reach tens of MB. */
export const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024; // 100MB

export type XArchiveSlice = "follower" | "following" | "tweets" | "account";

export const X_ARCHIVE_SLICES: XArchiveSlice[] = [
  "follower",
  "following",
  "tweets",
  "account",
];

// Base name and multi-part variants: follower.js, follower.part1.js,
// tweets-part1.js; old exports use the singular tweet.js.
const SLICE_BASENAME_RE: Record<XArchiveSlice, RegExp> = {
  follower: /^follower(?:[-.]part(\d+))?\.js$/i,
  following: /^following(?:[-.]part(\d+))?\.js$/i,
  tweets: /^tweets?(?:[-.]part(\d+))?\.js$/i,
  account: /^account(?:[-.]part(\d+))?\.js$/i,
};

interface SliceCandidate {
  path: string;
  dir: string;
  part: number;
  originalSize: number;
}

/**
 * Match an archive entry path against a slice. Data files live in `data/`
 * (optionally under one wrapping folder when the zip was re-packed); very
 * old exports had them at the root.
 */
function matchSlice(path: string, slice: XArchiveSlice): { part: number } | null {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const basename = segments[segments.length - 1]!;
  const match = SLICE_BASENAME_RE[slice].exec(basename);
  if (!match) return null;

  const parent = segments.length > 1 ? segments[segments.length - 2]!.toLowerCase() : null;
  if (parent !== null && parent !== "data") return null;

  return { part: match[1] ? parseInt(match[1], 10) : 0 };
}

/**
 * Pick the entry paths for each slice, in part order. When matching files
 * exist in several directories (e.g. root and a re-packed copy), only the
 * shallowest directory is used so parts aren't mixed across copies.
 */
export function findArchiveSliceEntries(
  paths: string[]
): Record<XArchiveSlice, string[]> {
  const result = {} as Record<XArchiveSlice, string[]>;

  for (const slice of X_ARCHIVE_SLICES) {
    const candidates: SliceCandidate[] = [];
    for (const path of paths) {
      const match = matchSlice(path, slice);
      if (match) {
        const normalized = path.replace(/\\/g, "/");
        candidates.push({
          path,
          dir: normalized.slice(0, normalized.lastIndexOf("/") + 1),
          part: match.part,
          originalSize: 0,
        });
      }
    }

    if (candidates.length === 0) {
      result[slice] = [];
      continue;
    }

    const dirs = [...new Set(candidates.map((c) => c.dir))].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)
    );
    const chosenDir = dirs[0]!;

    result[slice] = candidates
      .filter((c) => c.dir === chosenDir)
      .sort((a, b) => a.part - b.part || a.path.localeCompare(b.path))
      .map((c) => c.path);
  }

  return result;
}

export interface XArchiveSliceFiles {
  /** Entry paths per slice, in part order. */
  entries: Record<XArchiveSlice, string[]>;
  /** Decoded file text per entry path. */
  texts: Map<string, string>;
}

/**
 * Extract the follower / following / tweets / account data files from an
 * X archive zip buffer. Slices that aren't present come back as empty arrays.
 */
export function extractArchiveSlices(zipBytes: Uint8Array): XArchiveSliceFiles {
  const metadata: UnzipFileInfo[] = [];
  try {
    unzipSync(zipBytes, {
      filter(file) {
        metadata.push(file);
        return false;
      },
    });
  } catch {
    throw new Error("Invalid zip archive");
  }

  const entries = findArchiveSliceEntries(metadata.map((f) => f.name));
  const selected = new Set(Object.values(entries).flat());

  for (const meta of metadata) {
    if (selected.has(meta.name) && meta.originalSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(
        `${meta.name} is too large (max ${MAX_ARCHIVE_ENTRY_BYTES / (1024 * 1024)}MB per data file)`
      );
    }
  }

  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(zipBytes, {
      filter(file) {
        return selected.has(file.name);
      },
    });
  } catch {
    throw new Error("Invalid zip archive");
  }

  const decoder = new TextDecoder("utf-8");
  const texts = new Map<string, string>();
  for (const path of selected) {
    const bytes = extracted[path];
    if (!bytes) continue;
    if (bytes.length > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(
        `${path} is too large (max ${MAX_ARCHIVE_ENTRY_BYTES / (1024 * 1024)}MB per data file)`
      );
    }
    texts.set(path, decoder.decode(bytes));
  }

  return { entries, texts };
}
