import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  backfillXArchiveHandles,
  importXArchiveContacts,
  importXArchiveTweets,
  mergeArchiveUsers,
  parseXArchive,
  resolveXImportAccount,
} from "@/lib/platforms/x/archive-import";
import { readXArchiveZip } from "@/lib/platforms/x/import-file";
import { recordImportRun } from "@/lib/workflows/record-import-run";
import type { SyncResult } from "@/lib/platforms/adapter";

const X_ARCHIVE_CONTACTS_SUBTYPE = "x_archive_contacts";
const X_ARCHIVE_POSTS_SUBTYPE = "x_archive_posts";
/** Subtype for failures before either phase produced a result. */
const X_ARCHIVE_SUBTYPE = "x_archive";

/** Client-file problems reported as 400s (mirrors the LinkedIn import route). */
const CLIENT_ERROR_RE =
  /too large|must be a \.zip|Invalid zip|No follower|No importable|window\.YTD|Invalid JSON|JSON array/;

/**
 * POST /api/platforms/x/import
 * Import an official X data archive zip: followers/following as contacts
 * (Phase A) and tweets as content (Phase B). No connected X account is
 * required — tweets attach to the connected account when one exists, else
 * to a credential-less placeholder account.
 */
export async function POST(req: NextRequest) {
  let file: File | null = null;
  const startedAt = Math.floor(Date.now() / 1000);

  try {
    const formData = await req.formData();
    file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const zipBytes = await readXArchiveZip(file);
    const contents = parseXArchive(zipBytes);

    const hasContactSlices =
      contents.files.follower.length > 0 || contents.files.following.length > 0;
    const hasTweetSlices = contents.files.tweets.length > 0;

    let contactsResult: SyncResult | null = null;
    let contactsRunId: string | null = null;
    let handleBackfillResult: SyncResult | null = null;
    if (hasContactSlices) {
      const merged = mergeArchiveUsers(contents.followers, contents.following);
      const preAllocatedContactsRunId = nanoid();
      contactsResult = importXArchiveContacts(merged, preAllocatedContactsRunId);
      handleBackfillResult = backfillXArchiveHandles(contents.handleMap);
      contactsRunId = recordImportRun({
        id: preAllocatedContactsRunId,
        platform: "x",
        importSubType: X_ARCHIVE_CONTACTS_SUBTYPE,
        source: "zip",
        fileName: file.name,
        startedAt,
        totalRows: merged.length,
        result: contactsResult,
      }).id;
    }

    let postsResult: SyncResult | null = null;
    let postsRunId: string | null = null;
    if (hasTweetSlices) {
      const account = resolveXImportAccount(contents.account);
      postsResult = importXArchiveTweets(
        contents.tweets,
        account.id,
        contents.account?.accountId ?? null
      );
      postsRunId = recordImportRun({
        platform: "x",
        importSubType: X_ARCHIVE_POSTS_SUBTYPE,
        source: "zip",
        fileName: file.name,
        startedAt,
        totalRows: contents.tweets.length,
        result: postsResult,
      }).id;
    }

    const combined: SyncResult = {
      added: (contactsResult?.added ?? 0) + (postsResult?.added ?? 0),
      updated:
        (contactsResult?.updated ?? 0) +
        (postsResult?.updated ?? 0) +
        (handleBackfillResult?.updated ?? 0),
      skipped:
        (contactsResult?.skipped ?? 0) +
        (postsResult?.skipped ?? 0) +
        (handleBackfillResult?.skipped ?? 0),
      errors: [
        ...(contactsResult?.errors ?? []),
        ...(postsResult?.errors ?? []),
        ...(handleBackfillResult?.errors ?? []),
      ],
    };

    const mergedContacts = hasContactSlices
      ? mergeArchiveUsers(contents.followers, contents.following)
      : [];

    return NextResponse.json({
      success: true,
      result: combined,
      contacts: contactsResult,
      posts: postsResult,
      handleBackfill: handleBackfillResult,
      uniqueContactCount: mergedContacts.length,
      totalRows:
        contents.followers.length + contents.following.length + contents.tweets.length,
      source: "zip",
      workflowRunId: contactsRunId ?? postsRunId,
      workflowRunIds: [contactsRunId, postsRunId].filter((id): id is string => !!id),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";

    // Record failed attempts once we know a plausible archive was uploaded.
    if (file && file.name.toLowerCase().endsWith(".zip")) {
      recordImportRun({
        platform: "x",
        importSubType: X_ARCHIVE_SUBTYPE,
        source: "zip",
        fileName: file.name,
        startedAt,
        error: message,
      });
    }

    const status = CLIENT_ERROR_RE.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
