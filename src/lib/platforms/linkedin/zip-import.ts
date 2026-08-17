import { unzipSync, type UnzipFileInfo } from "fflate";

const CONNECTIONS_BASENAME = "connections.csv";

/** Max decompressed Connections.csv size — matches CSV upload cap in import route. */
export const MAX_CONNECTIONS_CSV_BYTES = 5 * 1024 * 1024; // 5MB

function isConnectionsCsvCandidate(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return false;
  return segments[segments.length - 1]!.toLowerCase() === CONNECTIONS_BASENAME;
}

/**
 * Locate Connections.csv inside a LinkedIn Basic Data Export zip.
 * Prefers the shallowest path when multiple matches exist (root before nested).
 */
export function findConnectionsCsvEntry(paths: string[]): string | undefined {
  const matches = paths.filter(isConnectionsCsvCandidate);

  if (matches.length === 0) return undefined;

  return matches.sort((a, b) => a.split("/").length - b.split("/").length)[0];
}

/**
 * Read zip central-directory metadata without decompressing member files.
 */
function listConnectionsCsvCandidates(zipBytes: Uint8Array): UnzipFileInfo[] {
  const candidates: UnzipFileInfo[] = [];
  try {
    unzipSync(zipBytes, {
      filter(file) {
        if (isConnectionsCsvCandidate(file.name)) {
          candidates.push(file);
        }
        return false;
      },
    });
  } catch {
    throw new Error("Invalid zip archive");
  }
  return candidates;
}

/**
 * Extract Connections.csv text from a LinkedIn Basic Data Export zip buffer.
 * Only the selected Connections.csv entry is decompressed; other archive members
 * are ignored after metadata inspection to avoid zip-bomb allocation.
 */
export function extractConnectionsCsvFromZip(zipBytes: Uint8Array): string {
  const candidates = listConnectionsCsvCandidates(zipBytes);
  const entryPath = findConnectionsCsvEntry(candidates.map((file) => file.name));

  if (!entryPath) {
    throw new Error(
      "No Connections.csv found in zip. Use a LinkedIn Basic Data Export archive."
    );
  }

  const entryMeta = candidates.find((file) => file.name === entryPath);
  if (!entryMeta) {
    throw new Error(
      "No Connections.csv found in zip. Use a LinkedIn Basic Data Export archive."
    );
  }

  if (entryMeta.originalSize > MAX_CONNECTIONS_CSV_BYTES) {
    throw new Error(
      `Connections.csv is too large (max ${MAX_CONNECTIONS_CSV_BYTES / (1024 * 1024)}MB)`
    );
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes, {
      filter(file) {
        return file.name === entryPath;
      },
    });
  } catch {
    throw new Error("Invalid zip archive");
  }

  const csvBytes = entries[entryPath];
  if (!csvBytes || csvBytes.length === 0) {
    throw new Error("Connections.csv in zip archive is empty");
  }

  if (csvBytes.length > MAX_CONNECTIONS_CSV_BYTES) {
    throw new Error(
      `Connections.csv is too large (max ${MAX_CONNECTIONS_CSV_BYTES / (1024 * 1024)}MB)`
    );
  }

  return new TextDecoder("utf-8").decode(csvBytes);
}
