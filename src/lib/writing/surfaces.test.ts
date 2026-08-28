import { describe, expect, it } from "vitest";
import { SURFACE_IDS, parseSurfaceId, surfaceForDraft } from "@/lib/writing/surfaces";

describe("writing surfaces", () => {
  it("keeps the accepted vocabulary closed", () => {
    expect(SURFACE_IDS).toHaveLength(18);
    expect(parseSurfaceId("x/thread")).toBe("x/thread");
    expect(parseSurfaceId("x/Thread")).toBeNull();
    expect(parseSurfaceId("bluesky/post")).toBeNull();
  });

  it("derives only registered post and thread surfaces", () => {
    expect(surfaceForDraft("x", "post")).toBe("x/post");
    expect(surfaceForDraft("threads", "thread")).toBe("threads/thread");
    expect(surfaceForDraft("instagram", "post")).toBeNull();
  });
});
