import { unzipSync, type UnzipFileInfo } from "fflate";

export const MAX_TAKEOUT_CONTACT_FILE_BYTES = 10 * 1024 * 1024; // 10MB per entry

function isContactFileCandidate(path: string, extension: "vcf" | "csv"): boolean {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 4) return false;
  const base = segments[segments.length - 1]!.toLowerCase();
  return base.endsWith(`.${extension}`);
}

/** Prefer shallow Contacts/*.vcf paths from Google Takeout archives. */
export function findTakeoutVcfEntries(paths: string[]): string[] {
  const matches = paths.filter((path) => isContactFileCandidate(path, "vcf"));
  return matches.sort((a, b) => {
    const depth = (path: string) => path.split("/").length;
    const aContacts = /contacts/i.test(a) ? 0 : 1;
    const bContacts = /contacts/i.test(b) ? 0 : 1;
    if (aContacts !== bContacts) return aContacts - bContacts;
    return depth(a) - depth(b);
  });
}

function csvPreferenceScore(path: string): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  if (base === "all contacts.csv") return 0;
  if (base === "my contacts.csv") return 1;
  if (/contacts/i.test(lower)) return 2;
  return 3;
}

/** Pick one canonical Contacts CSV from a Takeout archive (avoids duplicate group exports). */
export function findTakeoutCsvEntry(paths: string[]): string | undefined {
  const matches = paths.filter((path) => isContactFileCandidate(path, "csv"));
  if (matches.length === 0) return undefined;

  return matches.sort((a, b) => {
    const scoreDiff = csvPreferenceScore(a) - csvPreferenceScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    const depthDiff = a.split("/").length - b.split("/").length;
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  })[0];
}

function listContactFileCandidates(
  zipBytes: Uint8Array,
  extension: "vcf" | "csv"
): UnzipFileInfo[] {
  const candidates: UnzipFileInfo[] = [];
  try {
    unzipSync(zipBytes, {
      filter(file) {
        if (isContactFileCandidate(file.name, extension)) {
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

function decodeZipEntry(
  zipBytes: Uint8Array,
  entryPath: string,
  entryMeta: UnzipFileInfo,
  label: string
): string {
  if (entryMeta.originalSize > MAX_TAKEOUT_CONTACT_FILE_BYTES) {
    throw new Error(
      `${label} is too large (max ${MAX_TAKEOUT_CONTACT_FILE_BYTES / (1024 * 1024)}MB)`
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

  const fileBytes = entries[entryPath];
  if (!fileBytes || fileBytes.length === 0) {
    throw new Error(`${label} in zip archive is empty`);
  }
  if (fileBytes.length > MAX_TAKEOUT_CONTACT_FILE_BYTES) {
    throw new Error(
      `${label} is too large (max ${MAX_TAKEOUT_CONTACT_FILE_BYTES / (1024 * 1024)}MB)`
    );
  }

  return new TextDecoder("utf-8").decode(fileBytes);
}

function extractTakeoutVcardText(zipBytes: Uint8Array, candidates: UnzipFileInfo[]): string {
  const entryPaths = findTakeoutVcfEntries(candidates.map((file) => file.name));
  const chunks: string[] = [];

  for (const entryPath of entryPaths) {
    const entryMeta = candidates.find((file) => file.name === entryPath);
    if (!entryMeta) continue;
    chunks.push(decodeZipEntry(zipBytes, entryPath, entryMeta, "Contacts file"));
  }

  const combined = chunks.join("\n").trim();
  if (!combined) {
    throw new Error("Contacts files in zip archive are empty");
  }

  return combined;
}

function extractTakeoutCsvText(zipBytes: Uint8Array, candidates: UnzipFileInfo[]): string {
  const entryPath = findTakeoutCsvEntry(candidates.map((file) => file.name));
  if (!entryPath) {
    throw new Error(
      "No contacts (.vcf or .csv) found in zip. Use a Google Takeout export with Contacts selected."
    );
  }

  const entryMeta = candidates.find((file) => file.name === entryPath);
  if (!entryMeta) {
    throw new Error(
      "No contacts (.vcf or .csv) found in zip. Use a Google Takeout export with Contacts selected."
    );
  }

  return decodeZipEntry(zipBytes, entryPath, entryMeta, "Contacts CSV");
}

/** Extract contact text from a Google Takeout contacts zip (vCard or CSV). */
export function extractTakeoutContactsFromZip(zipBytes: Uint8Array): string {
  const vcfCandidates = listContactFileCandidates(zipBytes, "vcf");
  if (vcfCandidates.length > 0) {
    return extractTakeoutVcardText(zipBytes, vcfCandidates);
  }

  const csvCandidates = listContactFileCandidates(zipBytes, "csv");
  return extractTakeoutCsvText(zipBytes, csvCandidates);
}

/** @deprecated Use extractTakeoutContactsFromZip */
export const extractTakeoutVcardsFromZip = extractTakeoutContactsFromZip;
