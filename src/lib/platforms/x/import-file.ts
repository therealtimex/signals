/**
 * Official X data archives bundle media alongside the data files, so they
 * can be far larger than a LinkedIn export. The cap bounds the in-memory
 * buffer for the upload; individual data files are capped separately in
 * archive-zip.ts.
 */
export const MAX_ARCHIVE_ZIP_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Validate an uploaded X archive and return its bytes.
 * Throws with a user-facing message for wrong extensions or oversized files.
 */
export async function readXArchiveZip(file: File): Promise<Uint8Array> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("File must be a .zip X data archive");
  }

  if (file.size > MAX_ARCHIVE_ZIP_SIZE) {
    throw new Error(
      `File too large (max ${MAX_ARCHIVE_ZIP_SIZE / (1024 * 1024)}MB)`
    );
  }

  return new Uint8Array(await file.arrayBuffer());
}
