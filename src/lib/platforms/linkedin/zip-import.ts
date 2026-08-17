import { unzipSync } from "fflate";

const CONNECTIONS_BASENAME = "connections.csv";

/**
 * Locate Connections.csv inside a LinkedIn Basic Data Export zip.
 * Prefers the shallowest path when multiple matches exist (root before nested).
 */
export function findConnectionsCsvEntry(paths: string[]): string | undefined {
  const matches = paths.filter((entryPath) => {
    const segments = entryPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (segments.length === 0 || segments.length > 2) return false;
    return segments[segments.length - 1]!.toLowerCase() === CONNECTIONS_BASENAME;
  });

  if (matches.length === 0) return undefined;

  return matches.sort((a, b) => a.split("/").length - b.split("/").length)[0];
}

/**
 * Extract Connections.csv text from a LinkedIn Basic Data Export zip buffer.
 */
export function extractConnectionsCsvFromZip(zipBytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error("Invalid zip archive");
  }

  const entryPath = findConnectionsCsvEntry(Object.keys(entries));
  if (!entryPath) {
    throw new Error(
      "No Connections.csv found in zip. Use a LinkedIn Basic Data Export archive."
    );
  }

  const csvBytes = entries[entryPath];
  if (!csvBytes || csvBytes.length === 0) {
    throw new Error("Connections.csv in zip archive is empty");
  }

  return new TextDecoder("utf-8").decode(csvBytes);
}
