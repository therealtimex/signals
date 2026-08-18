import { unzipSync, type UnzipFileInfo } from "fflate";

export const MAX_TAKEOUT_VCF_BYTES = 10 * 1024 * 1024; // 10MB per vcf entry

function isVcfCandidate(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 4) return false;
  const base = segments[segments.length - 1]!.toLowerCase();
  return base.endsWith(".vcf");
}

/** Prefer shallow Contacts/*.vcf paths from Google Takeout archives. */
export function findTakeoutVcfEntries(paths: string[]): string[] {
  const matches = paths.filter(isVcfCandidate);
  return matches.sort((a, b) => {
    const depth = (p: string) => p.split("/").length;
    const aContacts = /contacts/i.test(a) ? 0 : 1;
    const bContacts = /contacts/i.test(b) ? 0 : 1;
    if (aContacts !== bContacts) return aContacts - bContacts;
    return depth(a) - depth(b);
  });
}

function listVcfCandidates(zipBytes: Uint8Array): UnzipFileInfo[] {
  const candidates: UnzipFileInfo[] = [];
  try {
    unzipSync(zipBytes, {
      filter(file) {
        if (isVcfCandidate(file.name)) {
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

/** Extract and concatenate vCard text from a Google Takeout contacts zip. */
export function extractTakeoutVcardsFromZip(zipBytes: Uint8Array): string {
  const candidates = listVcfCandidates(zipBytes);
  const entryPaths = findTakeoutVcfEntries(candidates.map((file) => file.name));

  if (entryPaths.length === 0) {
    throw new Error(
      "No .vcf contacts found in zip. Use a Google Takeout export with Contacts selected."
    );
  }

  const chunks: string[] = [];

  for (const entryPath of entryPaths) {
    const entryMeta = candidates.find((file) => file.name === entryPath);
    if (!entryMeta) continue;

    if (entryMeta.originalSize > MAX_TAKEOUT_VCF_BYTES) {
      throw new Error(
        `Contacts file is too large (max ${MAX_TAKEOUT_VCF_BYTES / (1024 * 1024)}MB per vcf)`
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

    const vcfBytes = entries[entryPath];
    if (!vcfBytes || vcfBytes.length === 0) continue;
    if (vcfBytes.length > MAX_TAKEOUT_VCF_BYTES) {
      throw new Error(
        `Contacts file is too large (max ${MAX_TAKEOUT_VCF_BYTES / (1024 * 1024)}MB per vcf)`
      );
    }

    chunks.push(new TextDecoder("utf-8").decode(vcfBytes));
  }

  const combined = chunks.join("\n").trim();
  if (!combined) {
    throw new Error("Contacts files in zip archive are empty");
  }

  return combined;
}
