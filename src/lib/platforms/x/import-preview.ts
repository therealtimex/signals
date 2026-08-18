import { parseXArchive, type XArchiveContents } from "@/lib/platforms/x/archive-import";
import { readXArchiveZip } from "@/lib/platforms/x/import-file";

export interface XArchiveImportPreview {
  source: "zip";
  fileName: string;
  fileSize: number;
  /** All importable rows: follower + following + tweet entries. */
  totalRows: number;
  followerCount: number;
  followingCount: number;
  tweetCount: number;
  /** Per-slice breakdown lines rendered on the inspection step. */
  details: string[];
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function sliceDetail(label: string, count: number, files: string[]): string {
  const names = files.map(basename);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` +${names.length - 3} more` : "";
  return `${label}: ${count} (${shown}${more})`;
}

/** Inspection detail lines for the found slices. */
export function buildArchiveDetails(contents: XArchiveContents): string[] {
  const details: string[] = [];
  if (contents.files.follower.length > 0) {
    details.push(sliceDetail("Followers", contents.followers.length, contents.files.follower));
  }
  if (contents.files.following.length > 0) {
    details.push(sliceDetail("Following", contents.following.length, contents.files.following));
  }
  if (contents.files.tweets.length > 0) {
    details.push(sliceDetail("Tweets", contents.tweets.length, contents.files.tweets));
  }
  return details;
}

/**
 * Inspect an uploaded X data archive without writing to the database:
 * validate kind and size, locate the data files, and count parseable rows.
 * Throws with a user-facing message for invalid files.
 */
export async function previewXArchiveImport(file: File): Promise<XArchiveImportPreview> {
  const zipBytes = await readXArchiveZip(file);
  const contents = parseXArchive(zipBytes);

  const followerCount = contents.followers.length;
  const followingCount = contents.following.length;
  const tweetCount = contents.tweets.length;
  const totalRows = followerCount + followingCount + tweetCount;

  if (totalRows === 0) {
    throw new Error(
      "No importable rows found in archive. Make sure it's an official X data archive."
    );
  }

  return {
    source: "zip",
    fileName: file.name,
    fileSize: file.size,
    totalRows,
    followerCount,
    followingCount,
    tweetCount,
    details: buildArchiveDetails(contents),
  };
}
