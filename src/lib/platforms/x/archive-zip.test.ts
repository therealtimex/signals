import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  extractArchiveSlices,
  findArchiveSliceEntries,
} from "@/lib/platforms/x/archive-zip";

function makeZip(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))
  );
}

describe("findArchiveSliceEntries", () => {
  it("locates data/*.js slices", () => {
    const entries = findArchiveSliceEntries([
      "Your archive.html",
      "data/follower.js",
      "data/following.js",
      "data/tweets.js",
      "data/account.js",
      "data/profile.js",
      "assets/js/app.js",
    ]);

    expect(entries.follower).toEqual(["data/follower.js"]);
    expect(entries.following).toEqual(["data/following.js"]);
    expect(entries.tweets).toEqual(["data/tweets.js"]);
    expect(entries.account).toEqual(["data/account.js"]);
  });

  it("orders multi-part files and accepts both part suffix styles", () => {
    const entries = findArchiveSliceEntries([
      "data/tweets-part2.js",
      "data/tweets.js",
      "data/tweets-part1.js",
      "data/follower.part1.js",
      "data/follower.part0.js",
    ]);

    expect(entries.tweets).toEqual([
      "data/tweets.js",
      "data/tweets-part1.js",
      "data/tweets-part2.js",
    ]);
    expect(entries.follower).toEqual([
      "data/follower.part0.js",
      "data/follower.part1.js",
    ]);
  });

  it("matches case-insensitively, at the root, under a wrapping folder, and old singular tweet.js", () => {
    const entries = findArchiveSliceEntries([
      "Data/FOLLOWER.JS",
      "following.js",
      "twitter-2024-01-01-abc/data/tweet.js",
    ]);

    expect(entries.follower).toEqual(["Data/FOLLOWER.JS"]);
    expect(entries.following).toEqual(["following.js"]);
    expect(entries.tweets).toEqual(["twitter-2024-01-01-abc/data/tweet.js"]);
  });

  it("does not confuse follower and following, or unrelated data files", () => {
    const entries = findArchiveSliceEntries([
      "data/following.js",
      "data/follower-notes.js",
      "data/account-suspension.js",
    ]);

    expect(entries.follower).toEqual([]);
    expect(entries.following).toEqual(["data/following.js"]);
    expect(entries.account).toEqual([]);
  });

  it("keeps parts from a single (shallowest) directory when duplicates exist", () => {
    const entries = findArchiveSliceEntries([
      "backup/data/tweets.js",
      "backup/data/tweets-part1.js",
      "data/tweets.js",
    ]);

    expect(entries.tweets).toEqual(["data/tweets.js"]);
  });
});

describe("extractArchiveSlices", () => {
  it("decompresses only matched entries", () => {
    const zip = makeZip({
      "data/follower.js": 'window.YTD.follower.part0 = [{"follower":{"accountId":"1"}}]',
      "data/manifest.js": "window.__THAR_CONFIG = {}",
      "Your archive.html": "<html></html>",
    });

    const { entries, texts } = extractArchiveSlices(zip);

    expect(entries.follower).toEqual(["data/follower.js"]);
    expect(texts.get("data/follower.js")).toContain("accountId");
    expect(texts.has("data/manifest.js")).toBe(false);
    expect(texts.has("Your archive.html")).toBe(false);
  });

  it("throws a user-facing error for invalid zips", () => {
    expect(() => extractArchiveSlices(strToU8("not a zip"))).toThrow(
      "Invalid zip archive"
    );
  });
});
