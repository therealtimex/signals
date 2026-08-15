export type TranscriptFetchResult =
  | { status: "ok"; content: unknown; byteSize: number; tokenCount: number | null }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function buildTranscriptApiUrl(runId: string, agentId: string): string {
  return `/api/simulations/${runId}/agents/${agentId}/transcript`;
}

export class TranscriptSessionCache {
  private cache = new Map<string, TranscriptFetchResult | "loading">();
  fetchCount = 0;

  get(agentId: string): TranscriptFetchResult | "loading" | undefined {
    return this.cache.get(agentId);
  }

  async load(
    runId: string,
    agentId: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<TranscriptFetchResult> {
    const cached = this.cache.get(agentId);
    if (cached && cached !== "loading" && cached.status !== "error") {
      return cached;
    }

    this.cache.set(agentId, "loading");
    this.fetchCount += 1;

    try {
      const response = await fetchFn(buildTranscriptApiUrl(runId, agentId));
      if (response.ok) {
        const body = (await response.json()) as {
          content: unknown;
          byteSize: number;
          tokenCount: number | null;
        };
        const result: TranscriptFetchResult = {
          status: "ok",
          content: body.content,
          byteSize: body.byteSize,
          tokenCount: body.tokenCount,
        };
        this.cache.set(agentId, result);
        return result;
      }

      if (response.status === 404) {
        const body = (await response.json()) as { code?: string };
        if (body.code === "TRANSCRIPT_NOT_FOUND") {
          const result: TranscriptFetchResult = { status: "not_found" };
          this.cache.set(agentId, result);
          return result;
        }
      }

      const result: TranscriptFetchResult = {
        status: "error",
        message: "Failed to load transcript.",
      };
      this.cache.set(agentId, result);
      return result;
    } catch {
      const result: TranscriptFetchResult = {
        status: "error",
        message: "Failed to load transcript.",
      };
      this.cache.set(agentId, result);
      return result;
    }
  }
}
