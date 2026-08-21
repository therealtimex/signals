import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapXUserToContact,
  mapXUserToIdentity,
  mapXTweetToContentItem,
  mapXTweetToContentPost,
  extractTweetMetrics,
} from "@/lib/platforms/x/mappers";
import type { XUser, XTweet } from "@/lib/platforms/x/client";

describe("mapXUserToContact", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps profile fields and upgrades avatar resolution", () => {
    const xUser: XUser = {
      id: "123",
      name: "Jane Doe",
      username: "janedoe",
      description: "Builder",
      location: "NYC",
      url: "https://janedoe.com",
      profile_image_url: "https://pbs.twimg.com/profile_normal.jpg",
      verified: true,
      public_metrics: {
        followers_count: 100,
        following_count: 50,
        tweet_count: 10,
        listed_count: 2,
      },
      created_at: "2020-01-01T00:00:00.000Z",
    };

    const contact = mapXUserToContact(xUser);

    expect(contact).toMatchObject({
      name: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      bio: "Builder",
      location: "NYC",
      website: "https://janedoe.com",
      photoUrl: "https://pbs.twimg.com/profile_400x400.jpg",
      platform: "x",
      platformUserId: "123",
      profileUrl: "https://x.com/janedoe",
    });
  });

  it("handles single-word names and missing optional fields", () => {
    const contact = mapXUserToContact({
      id: "solo",
      name: "Prince",
      username: "prince",
    });

    expect(contact.firstName).toBe("Prince");
    expect(contact.lastName).toBe("");
    expect(contact.website).toBeNull();
    expect(contact.bio).toBeNull();
  });

  it("maps identity with platform metrics JSON", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

    const xUser: XUser = {
      id: "99",
      name: "Solo",
      username: "solo",
      public_metrics: { followers_count: 1, following_count: 2, tweet_count: 3, listed_count: 0 },
    };

    const identity = mapXUserToIdentity(xUser, "contact-1");

    expect(identity.contactId).toBe("contact-1");
    expect(identity.platformHandle).toBe("solo");
    expect(identity.lastSyncedAt).toBe(Math.floor(Date.parse("2026-01-15T12:00:00Z") / 1000));
    expect(JSON.parse(identity.platformData!)).toMatchObject({
      followersCount: 1,
      followingCount: 2,
      tweetCount: 3,
    });
  });
});

describe("mapXTweetToContentItem", () => {
  it("classifies replies vs posts", () => {
    const tweet: XTweet = {
      id: "t1",
      text: "@user thanks!",
      author_id: "a1",
      created_at: "2026-01-01T00:00:00.000Z",
    };

    const item = mapXTweetToContentItem(tweet, "acct-1", "received");
    expect(item.contentType).toBe("reply");
    expect(item.origin).toBe("received");
    expect(item.direction).toBe("inbound");
  });
});

describe("mapXTweetToContentPost", () => {
  it("maps tweet metrics and platform URL", () => {
    const tweet: XTweet = {
      id: "tweet-42",
      text: "Hello",
      author_id: "a1",
      created_at: "2026-01-02T12:00:00.000Z",
      public_metrics: {
        like_count: 3,
        retweet_count: 1,
        reply_count: 2,
        quote_count: 0,
      },
    };

    const post = mapXTweetToContentPost(tweet, "acct-1");
    expect(post.platformPostId).toBe("tweet-42");
    expect(post.platformUrl).toBe("https://x.com/i/status/tweet-42");
    expect(JSON.parse(post.engagementSnapshot!)).toEqual({
      likes: 3,
      retweets: 1,
      replies: 2,
      quotes: 0,
    });
  });
});

describe("extractTweetMetrics", () => {
  it("returns zeroes when metrics are missing", () => {
    const metrics = extractTweetMetrics({ id: "1", text: "hello", author_id: "a" });
    expect(metrics).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
      retweets: 0,
      quotes: 0,
      bookmarks: 0,
      impressions: 0,
    });
  });
});
