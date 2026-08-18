import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  contentItems,
  contentPosts,
  engagementMetrics,
  platformAccounts,
} from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { createPlatformAccount } from "@/lib/db/queries/platform-accounts";
import { updateContact } from "@/lib/db/queries/contacts";
import { getExploreMap } from "@/lib/db/queries/explore-map";
import {
  importXArchiveContacts,
  importXArchiveTweets,
  mergeArchiveUsers,
  parseXArchive,
  resolveXImportAccount,
} from "@/lib/platforms/x/archive-import";
import { previewXArchiveImport } from "@/lib/platforms/x/import-preview";
import { resetCoreTables } from "@/test/db";

function ytd(slice: string, rows: unknown[], part = 0): string {
  return `window.YTD.${slice}.part${part} = ${JSON.stringify(rows)}`;
}

const FOLLOWER_JS = ytd("follower", [
  { follower: { accountId: "111", userLink: "https://twitter.com/intent/user?user_id=111" } },
  { follower: { accountId: "222", userLink: "https://twitter.com/intent/user?user_id=222" } },
]);

const FOLLOWING_JS = ytd("following", [
  { following: { accountId: "222", userLink: "https://twitter.com/intent/user?user_id=222" } },
  { following: { accountId: "333", userLink: "https://twitter.com/intent/user?user_id=333" } },
]);

const TWEETS_JS = ytd("tweets", [
  {
    tweet: {
      id_str: "9001",
      full_text: "Hello world",
      created_at: "Wed Oct 10 20:19:24 +0000 2018",
      favorite_count: "3",
      retweet_count: "1",
    },
  },
  {
    tweet: {
      id_str: "9002",
      full_text: "@friend nice one",
      created_at: "Thu Oct 11 08:00:00 +0000 2018",
      favorite_count: "0",
      retweet_count: "0",
      in_reply_to_status_id_str: "9000",
    },
  },
]);

const ACCOUNT_JS = ytd("account", [
  {
    account: {
      email: "me@example.com",
      username: "me_handle",
      accountId: "42",
      accountDisplayName: "Me Myself",
    },
  },
]);

function makeArchiveZip(
  files: Record<string, string> = {
    "data/follower.js": FOLLOWER_JS,
    "data/following.js": FOLLOWING_JS,
    "data/tweets.js": TWEETS_JS,
    "data/account.js": ACCOUNT_JS,
    "Your archive.html": "<html></html>",
  }
): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))
  );
}

beforeEach(() => {
  resetCoreTables();
  db.delete(engagementMetrics).run();
  db.delete(platformAccounts).run();
});

describe("parseXArchive", () => {
  it("parses followers, following, tweets, and account info from a fixture zip", () => {
    const contents = parseXArchive(makeArchiveZip());

    expect(contents.files.follower).toEqual(["data/follower.js"]);
    expect(contents.followers.map((u) => u.accountId)).toEqual(["111", "222"]);
    expect(contents.following.map((u) => u.accountId)).toEqual(["222", "333"]);
    expect(contents.tweets).toHaveLength(2);
    expect(contents.tweets[0]).toMatchObject({
      idStr: "9001",
      fullText: "Hello world",
      createdAt: "2018-10-10T20:19:24.000Z",
      favoriteCount: 3,
      retweetCount: 1,
      isReply: false,
    });
    expect(contents.tweets[1]!.isReply).toBe(true);
    expect(contents.account).toEqual({
      accountId: "42",
      username: "me_handle",
      displayName: "Me Myself",
    });
  });

  it("concatenates multi-part slices", () => {
    const contents = parseXArchive(
      makeArchiveZip({
        "data/follower.js": FOLLOWER_JS,
        "data/follower-part1.js": ytd(
          "follower",
          [{ follower: { accountId: "444" } }],
          1
        ),
      })
    );

    expect(contents.followers.map((u) => u.accountId)).toEqual(["111", "222", "444"]);
  });

  it("rejects zips without any importable data files", () => {
    expect(() =>
      parseXArchive(makeArchiveZip({ "data/profile.js": ytd("profile", []) }))
    ).toThrow(/No follower, following, or tweets data/);
  });
});

describe("mergeArchiveUsers", () => {
  it("merges mutuals into a single row with both flags", () => {
    const contents = parseXArchive(makeArchiveZip());
    const merged = mergeArchiveUsers(contents.followers, contents.following);

    expect(merged).toHaveLength(3);
    const mutual = merged.find((u) => u.accountId === "222");
    expect(mutual).toMatchObject({ follower: true, following: true });
  });
});

describe("importXArchiveContacts", () => {
  it("creates thin contacts with X identities", () => {
    const contents = parseXArchive(makeArchiveZip());
    const merged = mergeArchiveUsers(contents.followers, contents.following);

    const result = importXArchiveContacts(merged);
    expect(result).toMatchObject({ added: 3, updated: 0, skipped: 0 });
    expect(result.errors).toEqual([]);

    const identity = db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.platformUserId, "222"))
      .get();
    expect(identity).toBeDefined();
    expect(identity!.platform).toBe("x");
    expect(identity!.platformUrl).toBe("https://x.com/i/user/222");
    expect(JSON.parse(identity!.platformData!)).toMatchObject({
      source: "x_archive_import",
      archiveFollower: true,
      archiveFollowing: true,
    });

    const contact = db.select().from(contacts).where(eq(contacts.id, identity!.contactId)).get();
    expect(contact!.name).toBe("X user 222");
  });

  it("is idempotent — re-import skips existing identities", () => {
    const contents = parseXArchive(makeArchiveZip());
    const merged = mergeArchiveUsers(contents.followers, contents.following);

    importXArchiveContacts(merged);
    const second = importXArchiveContacts(merged);

    expect(second).toMatchObject({ added: 0, updated: 0, skipped: 3 });
    expect(db.select().from(contacts).all()).toHaveLength(3);
  });

  it("projects audience edges for Explore when owner is set", () => {
    const owner = createContact({ name: "Me" }, "api:create_contact");
    updateContact(owner.id, { isSelf: true });

    const contents = parseXArchive(makeArchiveZip());
    const merged = mergeArchiveUsers(contents.followers, contents.following);
    importXArchiveContacts(merged);

    const map = getExploreMap();
    expect(map.meta.totalContacts).toBeGreaterThan(0);
    expect(map.edges.length).toBeGreaterThan(0);
  });

  it("merges archive flags into identities that already exist from API sync", () => {
    const contact = createContact({ name: "Known Person" }, "api:create_contact");
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "111",
      platformHandle: "@known",
      platformData: JSON.stringify({ followersCount: 10 }),
    });

    const result = importXArchiveContacts([
      { accountId: "111", userLink: null, follower: true, following: false },
    ]);

    expect(result).toMatchObject({ added: 0, updated: 1, skipped: 0 });
    const identity = db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.platformUserId, "111"))
      .get();
    expect(JSON.parse(identity!.platformData!)).toMatchObject({
      followersCount: 10,
      archiveFollower: true,
    });
    expect(db.select().from(contacts).all()).toHaveLength(1);
  });
});

describe("resolveXImportAccount", () => {
  it("returns the connected X account when one exists", () => {
    const existing = createPlatformAccount({
      platform: "x",
      displayName: "@connected",
      authType: "oauth",
      credentialsEncrypted: "enc",
      status: "active",
    });

    expect(resolveXImportAccount(null).id).toBe(existing.id);
  });

  it("creates a paused credential-less placeholder otherwise", () => {
    const account = resolveXImportAccount({
      accountId: "42",
      username: "me_handle",
      displayName: "Me Myself",
    });

    expect(account).toMatchObject({
      platform: "x",
      displayName: "@me_handle (archive)",
      authType: "session",
      status: "paused",
      credentialsEncrypted: null,
    });
  });
});

describe("importXArchiveTweets", () => {
  it("imports tweets as content items + posts + metrics, and re-import skips", () => {
    const contents = parseXArchive(makeArchiveZip());
    const account = resolveXImportAccount(contents.account);

    const result = importXArchiveTweets(contents.tweets, account.id, "42");
    expect(result).toMatchObject({ added: 2, updated: 0, skipped: 0 });

    const items = db.select().from(contentItems).all();
    expect(items).toHaveLength(2);
    const hello = items.find((i) => i.body === "Hello world")!;
    expect(hello).toMatchObject({
      contentType: "post",
      status: "imported",
      origin: "imported",
      direction: "outbound",
      platformAccountId: account.id,
    });
    const reply = items.find((i) => i.body === "@friend nice one")!;
    expect(reply.contentType).toBe("reply");

    const posts = db.select().from(contentPosts).all();
    expect(posts.map((p) => p.platformPostId).sort()).toEqual(["9001", "9002"]);
    expect(posts.every((p) => p.status === "imported")).toBe(true);

    const metrics = db.select().from(engagementMetrics).all();
    expect(metrics).toHaveLength(2);

    const second = importXArchiveTweets(contents.tweets, account.id, "42");
    expect(second).toMatchObject({ added: 0, updated: 0, skipped: 2 });
    expect(db.select().from(contentItems).all()).toHaveLength(2);
  });
});

describe("previewXArchiveImport", () => {
  it("previews counts and per-slice details without writing to the database", async () => {
    const file = new File([Uint8Array.from(makeArchiveZip())], "twitter-2024-01-01-abc.zip", {
      type: "application/zip",
    });

    const preview = await previewXArchiveImport(file);

    expect(preview).toMatchObject({
      source: "zip",
      fileName: "twitter-2024-01-01-abc.zip",
      totalRows: 6,
      followerCount: 2,
      followingCount: 2,
      tweetCount: 2,
    });
    expect(preview.details).toEqual([
      "Followers: 2 (follower.js)",
      "Following: 2 (following.js)",
      "Tweets: 2 (tweets.js)",
    ]);

    expect(db.select().from(contacts).all()).toHaveLength(0);
    expect(db.select().from(contentItems).all()).toHaveLength(0);
    expect(db.select().from(platformAccounts).all()).toHaveLength(0);
  });

  it("rejects unsupported file extensions", async () => {
    const file = new File(["hi"], "archive.tar.gz");
    await expect(previewXArchiveImport(file)).rejects.toThrow(/must be a \.zip/);
  });

  it("rejects zips without X archive data files", async () => {
    const zip = makeArchiveZip({ "data/profile.js": ytd("profile", []) });
    const file = new File([Uint8Array.from(zip)], "twitter.zip");
    await expect(previewXArchiveImport(file)).rejects.toThrow(
      /No follower, following, or tweets data/
    );
  });
});
