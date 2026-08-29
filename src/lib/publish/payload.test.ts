import { describe, expect, it } from "vitest";
import {
  normalizePublishJobKind,
  resolveSourcePostUrl,
  validatePublishJobPayload,
} from "@/lib/publish/payload";

describe("publish payload validation", () => {
  it("defaults missing kind to original and requires text", () => {
    expect(normalizePublishJobKind(undefined)).toBe("original");
    expect(
      validatePublishJobPayload({
        text: "",
        platforms: ["x"],
      })
    ).toMatchObject({ ok: false, errorCode: "invalid_request" });
    expect(
      validatePublishJobPayload({
        text: "Hello",
        platforms: ["x"],
      }).ok
    ).toBe(true);
  });

  it("resolves X source post urls from ids", () => {
    expect(
      resolveSourcePostUrl({
        sourcePostId: "1234567890",
        platform: "x",
      })
    ).toBe("https://x.com/i/status/1234567890");
  });

  it("accepts repost jobs with a source url and empty text", () => {
    const result = validatePublishJobPayload({
      text: "",
      platforms: ["x"],
      kind: "repost",
      sourcePostUrl: "https://x.com/someone/status/99",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.kind).toBe("repost");
      expect(result.payload.sourcePostUrl).toBe("https://x.com/someone/status/99");
    }
  });

  it("requires comment text for quote jobs", () => {
    expect(
      validatePublishJobPayload({
        text: "",
        platforms: ["x"],
        kind: "quote",
        sourcePostId: "42",
      })
    ).toMatchObject({ ok: false });

    const result = validatePublishJobPayload({
      text: "Strong take.",
      platforms: ["x"],
      kind: "quote",
      sourcePostId: "42",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects repost/quote on non-X platforms in v1", () => {
    expect(
      validatePublishJobPayload({
        text: "",
        platforms: ["facebook"],
        kind: "repost",
        sourcePostUrl: "https://www.facebook.com/someone/posts/1",
      })
    ).toMatchObject({ ok: false, errorCode: "invalid_request" });
  });

  it("accepts facebook original publish jobs", () => {
    const result = validatePublishJobPayload({
      text: "Launch day notes",
      platforms: ["facebook"],
      kind: "original",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.platforms).toEqual(["facebook"]);
    }
  });

  it("normalizes ordered X thread continuations and rejects invalid uses", () => {
    const result = validatePublishJobPayload({
      text: "A",
      threadTexts: [" B ", "C"],
      platforms: ["x"],
    });
    expect(result).toMatchObject({
      ok: true,
      payload: { text: "A", threadTexts: ["B", "C"] },
    });
    expect(
      validatePublishJobPayload({
        text: "A",
        threadTexts: ["B"],
        platforms: ["facebook"],
      }),
    ).toMatchObject({ ok: false, errorCode: "invalid_request" });
    expect(
      validatePublishJobPayload({ text: "A", threadTexts: ["  "], platforms: ["x"] }),
    ).toMatchObject({ ok: false, errorCode: "invalid_request" });
    const empty = validatePublishJobPayload({ text: "A", threadTexts: [], platforms: ["x"] });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.payload).not.toHaveProperty("threadTexts");
  });
});
