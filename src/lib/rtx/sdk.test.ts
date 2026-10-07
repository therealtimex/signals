import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  bootstrapRtxIfEmbedded,
  getRtxBootstrapState,
  resetRtxBootstrapState,
} from "@/lib/rtx/bootstrap";
import { pingRtx, registerWithRtx } from "@/lib/rtx/sdk";

describe("rtx sdk", () => {
  it("registers with manifest permissions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: "ok",
        permissions: { granted: ["credentials.list"], denied: [] },
      }),
    });

    const result = await registerWithRtx(fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-1",
      SERVER_URL: "http://127.0.0.1:3001",
      RTX_APP_NAME: "Signals Dev",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/sdk/register",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-app-id": "app-1" }),
      })
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.permissions).toContain("credentials.list");
    expect(body.permissions).toContain("llm.embed");
    expect(body.permissions).toContain("llm.chat");
  });

  it("registers a Dev app with only its slot's needs, and with none when there is no needs.json (#545)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "signals-rtx-register-"));
    try {
      const env = {
        RTX_APP_ID: "dev-app-1",
        SERVER_URL: "http://127.0.0.1:3101",
        SIGNALS_INSTANCE: "dev",
        SIGNALS_DATA_DIR: dataDir,
      };
      const registered = async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ success: true, message: "All permissions already processed" }),
        });
        const result = await registerWithRtx(fetchMock as unknown as typeof fetch, env);
        expect(result.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3101/sdk/register", expect.anything());
        return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).permissions;
      };

      expect(await registered()).toEqual([]);
      mkdirSync(join(dataDir, ".launcher"));
      writeFileSync(join(dataDir, ".launcher", "needs.json"), JSON.stringify({ needs: ["llm.chat", "not.in.manifest"] }));
      expect(await registered()).toEqual(["llm.chat"]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("pings with x-app-id header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, mode: "production", appId: "app-1" }),
    });

    const result = await pingRtx(fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-1",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/sdk/ping",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-app-id": "app-1" }),
      })
    );
  });
});

describe("rtx bootstrap", () => {
  beforeEach(() => {
    resetRtxBootstrapState();
  });

  it("skips network calls in standalone mode", async () => {
    const fetchMock = vi.fn();
    const state = await bootstrapRtxIfEmbedded(fetchMock as unknown as typeof fetch, {});

    expect(state.mode).toBe("standalone");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRtxBootstrapState().mode).toBe("standalone");
  });

  it("registers and pings when embedded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          permissions: { granted: ["credentials.use"], denied: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, mode: "production", appId: "app-9" }),
      });

    const state = await bootstrapRtxIfEmbedded(fetchMock as unknown as typeof fetch, {
      RTX_APP_ID: "app-9",
      SERVER_URL: "http://127.0.0.1:3001",
    });

    expect(state.mode).toBe("embedded");
    expect(state.registered).toBe(true);
    expect(state.pingOk).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
