import { describe, expect, it, vi } from "vitest";
import {
  buildTranscriptApiUrl,
  TranscriptSessionCache,
} from "@/lib/simulation-transcript-client";

function asFetchMock(
  impl: (input: RequestInfo | URL) => Promise<Partial<Response> & { json: () => Promise<unknown> }>,
): typeof fetch {
  return impl as unknown as typeof fetch;
}

describe("TranscriptSessionCache", () => {
  it("fetches once per agent across expand cycles and handles 404 copy path", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(buildTranscriptApiUrl("run-1", "agent-1"));
      return {
        ok: false,
        status: 404,
        json: async () => ({ code: "TRANSCRIPT_NOT_FOUND" }),
      };
    });

    const cache = new TranscriptSessionCache();
    const first = await cache.load("run-1", "agent-1", asFetchMock(fetchMock));
    const second = await cache.load("run-1", "agent-1", asFetchMock(fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ status: "not_found" });
    expect(second).toEqual({ status: "not_found" });
  });

  it("does not fetch when transcript is already cached after success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: { text: "hello" },
        byteSize: 12,
        tokenCount: 2,
      }),
    }));

    const cache = new TranscriptSessionCache();
    await cache.load("run-2", "agent-2", asFetchMock(fetchMock));
    await cache.load("run-2", "agent-2", asFetchMock(fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
