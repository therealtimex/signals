import { describe, expect, it, vi } from "vitest";
import { rtxChat, rtxEmbed } from "@/lib/rtx/llm";

describe("rtx llm embed client", () => {
  it("returns RTX_NOT_CONFIGURED outside the Local App runtime", async () => {
    const result = await rtxEmbed(["hello"], vi.fn(), {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("RTX_NOT_CONFIGURED");
    }
  });

  it("stores provider-qualified model identity from the proxy response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        embeddings: [[0.1, 0.2, 0.3]],
        provider: "native",
        model: "default",
        dimensions: 3,
      }),
    });

    const result = await rtxEmbed(["hello"], fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-embed",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.qualifiedModel).toBe("native:default");
      expect(result.dimensions).toBe(3);
      expect(result.embeddings[0]).toBeInstanceOf(Float32Array);
    }

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ input: "hello" });
    expect(body.provider).toBeUndefined();
    expect(body.model).toBeUndefined();
  });

  it("maps PERMISSION_REQUIRED to an actionable error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        code: "PERMISSION_REQUIRED",
        error: "Permission required: llm.embed",
      }),
    });

    const result = await rtxEmbed(["hello"], fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-embed",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PERMISSION_REQUIRED");
      expect(result.error).toContain("llm.embed");
    }
  });
});

describe("rtx llm chat client", () => {
  it("returns RTX_NOT_CONFIGURED outside the Local App runtime", async () => {
    const result = await rtxChat([{ role: "user", content: "hello" }], vi.fn(), {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("RTX_NOT_CONFIGURED");
    }
  });

  it("stores provider-qualified model identity from the proxy response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        response: {
          content: '{"ok":true}',
          provider: "openai",
          model: "gpt-4o",
          metrics: { prompt_tokens: 10, completion_tokens: 5 },
        },
      }),
    });

    const result = await rtxChat([{ role: "user", content: "hello" }], fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-chat",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.qualifiedModel).toBe("openai:gpt-4o");
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);
    }
  });

  it("rejects the production SDK response shape when provider is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        response: {
          content: "hello",
          model: "gpt-4o",
          metrics: { prompt_tokens: 3, completion_tokens: 2 },
        },
      }),
    });

    const result = await rtxChat([{ role: "user", content: "hello" }], fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-chat",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("CHAT_ERROR");
      expect(result.error).toContain("provider");
    }
  });
});
