import { describe, expect, it } from "vitest";
import {
  SURFACE_IDS,
  contentTypeForSurface,
  parseSurfaceId,
  surfaceForDraft,
} from "@/lib/writing/surfaces";

describe("writing surfaces", () => {
  it("keeps the accepted vocabulary closed", () => {
    expect(SURFACE_IDS).toHaveLength(22);
    expect(parseSurfaceId("x/thread")).toBe("x/thread");
    expect(parseSurfaceId("x/Thread")).toBeNull();
    expect(parseSurfaceId("bluesky/post")).toBeNull();
  });

  it("registers a comment and a direct-message surface per nurture platform", () => {
    for (const surface of [
      "x/reply",
      "x/direct_message",
      "linkedin/comment",
      "linkedin/direct_message",
      "facebook/comment",
      "facebook/direct_message",
    ]) {
      expect(parseSurfaceId(surface)).toBe(surface);
    }
  });

  it("derives only registered post and thread surfaces", () => {
    expect(surfaceForDraft("x", "post")).toBe("x/post");
    expect(surfaceForDraft("threads", "thread")).toBe("threads/thread");
    expect(surfaceForDraft("instagram", "post")).toBeNull();
  });

  it("materializes replies, comments, and messages as something other than a post", () => {
    expect(contentTypeForSurface("x/post")).toBe("post");
    expect(contentTypeForSurface("x/thread")).toBe("thread");
    expect(contentTypeForSurface("x/reply")).toBe("reply");
    expect(contentTypeForSurface("linkedin/comment")).toBe("reply");
    expect(contentTypeForSurface("facebook/comment")).toBe("reply");
    expect(contentTypeForSurface("facebook/direct_message")).toBe("dm");
  });

  it("keeps a nurture surface out of the post/thread draft derivation", () => {
    // send-to-agent.ts proves a writing artifact is a publishable original by re-deriving
    // surfaceForDraft from the materialized platform + contentType. A nurture surface must never
    // round-trip through it.
    for (const platform of ["x", "linkedin", "facebook"] as const) {
      expect(surfaceForDraft(platform, "post")).toBe(`${platform}/post`);
      expect([surfaceForDraft(platform, "post"), surfaceForDraft(platform, "thread")]).not.toContain(
        `${platform}/comment`,
      );
    }
  });
});
