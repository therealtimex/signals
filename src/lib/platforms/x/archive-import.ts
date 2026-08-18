import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contactIdentities, contentItems, contentPosts, engagementMetrics } from "@/lib/db/schema";
import { createContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { createIdentity, updateIdentity } from "@/lib/db/queries/identities";
import { getContentPostByPlatformId } from "@/lib/db/queries/content";
import {
  createPlatformAccount,
  getPlatformAccountByPlatform,
} from "@/lib/db/queries/platform-accounts";
import {
  extractArchiveSlices,
  type XArchiveSlice,
} from "@/lib/platforms/x/archive-zip";
import { parseYtdArray, archiveDateToIso } from "@/lib/platforms/x/ytd-parse";
import {
  archiveTweetToXTweet,
  extractTweetMetrics,
  mapXArchiveUserToContact,
  mapXArchiveUserToIdentity,
  mapXTweetToContentItem,
  mapXTweetToContentPost,
  type XArchiveTweetRef,
  type XArchiveUserRef,
} from "@/lib/platforms/x/mappers";
import type { SyncResult } from "@/lib/platforms/adapter";
import type { PlatformAccount } from "@/lib/db/types";

/** Owner account info from data/account.js (used for the archive account). */
export interface XArchiveAccountInfo {
  accountId: string | null;
  username: string | null;
  displayName: string | null;
}

/** Parsed contents of an X data archive zip (no DB writes). */
export interface XArchiveContents {
  /** Entry paths found per slice, in part order. */
  files: Record<XArchiveSlice, string[]>;
  followers: XArchiveUserRef[];
  following: XArchiveUserRef[];
  tweets: XArchiveTweetRef[];
  account: XArchiveAccountInfo | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown): number {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Unwrap YTD rows like { "follower": {…} } into thin user refs. */
function parseArchiveUsers(texts: string[], wrapperKey: string): XArchiveUserRef[] {
  const users: XArchiveUserRef[] = [];
  for (const text of texts) {
    for (const entry of parseYtdArray(text)) {
      const record = asRecord(entry);
      const row = asRecord(record?.[wrapperKey]) ?? record;
      const accountId = asString(row?.accountId);
      if (!accountId) continue;
      users.push({ accountId, userLink: asString(row?.userLink) });
    }
  }
  return users;
}

/** Unwrap YTD rows like { "tweet": {…} } into tweet refs. */
function parseArchiveTweets(texts: string[]): XArchiveTweetRef[] {
  const tweets: XArchiveTweetRef[] = [];
  for (const text of texts) {
    for (const entry of parseYtdArray(text)) {
      const record = asRecord(entry);
      const row = asRecord(record?.tweet) ?? record;
      const idStr = asString(row?.id_str) ?? asString(row?.id);
      if (!idStr) continue;

      const fullText = asString(row?.full_text) ?? asString(row?.text) ?? "";
      tweets.push({
        idStr,
        fullText,
        createdAt: archiveDateToIso(asString(row?.created_at)),
        favoriteCount: asCount(row?.favorite_count),
        retweetCount: asCount(row?.retweet_count),
        isReply: !!asString(row?.in_reply_to_status_id_str) || fullText.startsWith("@"),
      });
    }
  }
  return tweets;
}

function parseArchiveAccount(texts: string[]): XArchiveAccountInfo | null {
  for (const text of texts) {
    for (const entry of parseYtdArray(text)) {
      const record = asRecord(entry);
      const row = asRecord(record?.account) ?? record;
      if (!row) continue;
      return {
        accountId: asString(row.accountId),
        username: asString(row.username),
        displayName: asString(row.accountDisplayName),
      };
    }
  }
  return null;
}

/**
 * Parse an X data archive zip into typed rows without writing to the
 * database. Throws with a user-facing message when the zip is invalid or
 * contains none of the data files we import.
 */
export function parseXArchive(zipBytes: Uint8Array): XArchiveContents {
  const { entries, texts } = extractArchiveSlices(zipBytes);

  const sliceTexts = (slice: XArchiveSlice): string[] =>
    entries[slice].map((path) => texts.get(path)).filter((t): t is string => !!t);

  if (
    entries.follower.length === 0 &&
    entries.following.length === 0 &&
    entries.tweets.length === 0
  ) {
    throw new Error(
      "No follower, following, or tweets data found in zip. Use the official X data archive (twitter-YYYY-MM-DD-….zip)."
    );
  }

  return {
    files: entries,
    followers: parseArchiveUsers(sliceTexts("follower"), "follower"),
    following: parseArchiveUsers(sliceTexts("following"), "following"),
    tweets: parseArchiveTweets(sliceTexts("tweets")),
    account: parseArchiveAccount(sliceTexts("account")),
  };
}

/** A follower/following row merged per unique account. */
export interface MergedArchiveUser extends XArchiveUserRef {
  follower: boolean;
  following: boolean;
}

/**
 * Merge follower and following rows by account id so mutuals are processed
 * once with both relationship flags (also dedupes repeat rows across parts).
 */
export function mergeArchiveUsers(
  followers: XArchiveUserRef[],
  following: XArchiveUserRef[]
): MergedArchiveUser[] {
  const merged = new Map<string, MergedArchiveUser>();

  for (const user of followers) {
    merged.set(user.accountId, {
      ...user,
      follower: true,
      following: false,
    });
  }
  for (const user of following) {
    const existing = merged.get(user.accountId);
    if (existing) {
      existing.following = true;
      existing.userLink = existing.userLink ?? user.userLink;
    } else {
      merged.set(user.accountId, { ...user, follower: false, following: true });
    }
  }

  return [...merged.values()];
}

/**
 * Import archive follower/following rows into the contact golden record.
 *
 * Dedup: contactIdentities on platform="x" + platformUserId (the archive's
 * accountId matches the API user id used by sync/enrichment). Existing
 * identities get archive relationship flags merged into platformData;
 * identities that already carry them are skipped, so re-import is idempotent.
 */
export function importXArchiveContacts(users: MergedArchiveUser[]): SyncResult {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const user of users) {
    try {
      processArchiveUser(user, result);
    } catch (err) {
      result.errors.push(
        `Failed to process X account ${user.accountId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

function processArchiveUser(user: MergedArchiveUser, result: SyncResult): void {
  const existing = db
    .select()
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, "x"),
        eq(contactIdentities.platformUserId, user.accountId)
      )
    )
    .get();

  if (existing) {
    let platformData: Record<string, unknown> = {};
    try {
      platformData = JSON.parse(existing.platformData ?? "{}");
    } catch {
      // Malformed platformData — rebuild with the archive flags only
    }

    const alreadyFlagged =
      (!user.follower || platformData.archiveFollower === true) &&
      (!user.following || platformData.archiveFollowing === true);
    if (alreadyFlagged) {
      result.skipped++;
      return;
    }

    if (user.follower) platformData.archiveFollower = true;
    if (user.following) platformData.archiveFollowing = true;

    updateIdentity(existing.id, { platformData: JSON.stringify(platformData) });
    result.updated++;
    return;
  }

  const contact = createContact(mapXArchiveUserToContact(user), "import:x_archive");
  createIdentity(
    mapXArchiveUserToIdentity(user, contact.id, {
      follower: user.follower,
      following: user.following,
    })
  );
  recalcEnrichment(contact.id);
  result.added++;
}

/**
 * Resolve the platform account archive tweets attach to: the connected X
 * account when one exists (so archive + API sync dedupe against each other),
 * else a credential-less placeholder row. The placeholder is created paused
 * and is upgraded in place by the OAuth callback if the user connects later.
 */
export function resolveXImportAccount(
  account: XArchiveAccountInfo | null
): PlatformAccount {
  const existing = getPlatformAccountByPlatform("x");
  if (existing) return existing;

  return createPlatformAccount({
    platform: "x",
    displayName: account?.username ? `@${account.username} (archive)` : "X archive",
    authType: "session",
    status: "paused",
  });
}

/**
 * Import archive tweets as content_items + content_posts.
 * Dedup: content_posts on platformPostId (tweet id_str) + platformAccountId.
 */
export function importXArchiveTweets(
  tweets: XArchiveTweetRef[],
  platformAccountId: string,
  authorId: string | null
): SyncResult {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of tweets) {
    try {
      if (getContentPostByPlatformId(row.idStr, platformAccountId)) {
        result.skipped++;
        continue;
      }

      const tweet = archiveTweetToXTweet(row, authorId);
      const itemData = {
        ...mapXTweetToContentItem(tweet, platformAccountId, "authored"),
        origin: "imported" as const,
        // The archive carries in_reply_to_status_id_str — a stronger reply
        // signal than the mapper's text prefix heuristic.
        contentType: row.isReply ? ("reply" as const) : ("post" as const),
      };
      const itemId = nanoid();
      db.insert(contentItems).values({ ...itemData, id: itemId }).run();

      const postData = mapXTweetToContentPost(tweet, platformAccountId);
      const postId = nanoid();
      db.insert(contentPosts)
        .values({ ...postData, id: postId, contentItemId: itemId })
        .run();

      db.insert(engagementMetrics)
        .values({
          id: nanoid(),
          contentPostId: postId,
          ...extractTweetMetrics(tweet),
        })
        .run();

      result.added++;
    } catch (err) {
      result.errors.push(
        `Failed to process tweet ${row.idStr}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
