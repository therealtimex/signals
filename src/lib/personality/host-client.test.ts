import { describe, expect, it, vi } from "vitest";
import {
  HostPersonalityError,
  PersonalityHostClient,
} from "@/lib/personality/host-client";

const workspace = {
  slug: "signals",
  id: "42",
  dir: "/safe/working-data/signals",
  key: "0123456789abcdef0123456789abcdef",
};
const env = { RTX_APP_ID: "signals-app", RTX_API_BASE_URL: "http://rtx.test" };

function transaction(status = "committed") {
  return {
    transactionId: "personality:fixture:attempt:1",
    status,
    origin: "sdk",
    appId: "signals-app",
    workspace,
    requestHash: "a".repeat(64),
    files: [{ path: "IDENTITY.md", fileHash: "b".repeat(64) }],
    shim: { requested: true, created: true, state: "symlink" },
    startedAt: "2026-08-30T00:00:00.000Z",
    finishedAt: "2026-08-30T00:00:01.000Z",
    replayed: false,
  };
}

describe("RealTimeX Personality host client", () => {
  it("uses authenticated landed routes and exact v1 transaction body", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/sdk/workspaces/signals/personality-files/transactions/");
      expect(new Headers(init?.headers).get("x-app-id")).toBe("signals-app");
      expect(JSON.parse(String(init?.body))).toEqual({
        schemaVersion: 1,
        workspaceId: "42",
        files: [{
          path: "IDENTITY.md",
          expectedFileHash: null,
          proposedFile: "managed",
          proposedFileHash: "b".repeat(64),
        }],
        claudeShim: { createIfAbsent: true },
      });
      return new Response(JSON.stringify({ success: true, transaction: transaction() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new PersonalityHostClient({ env, fetchImpl: fetchImpl as typeof fetch });
    await expect(client.putTransaction(
      workspace,
      "personality:fixture:attempt:1",
      [{
        path: "IDENTITY.md",
        expectedFileHash: null,
        proposedFile: "managed",
        proposedFileHash: "b".repeat(64),
      }],
      true,
    )).resolves.toMatchObject({ status: "committed" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retains typed terminal receipts and Retry-After without leaking response content", async () => {
    const restored = transaction("restored_failure");
    const client = new PersonalityHostClient({
      env,
      fetchImpl: (async () => new Response(JSON.stringify({
        success: false,
        code: "TRANSACTION_RESTORED_FAILURE",
        error: "failed safely",
        transaction: restored,
      }), {
        status: 500,
        headers: { "content-type": "application/json", "retry-after": "2" },
      })) as typeof fetch,
    });
    const error = await client.recoverTransaction(
      workspace,
      "personality:fixture:attempt:1",
    ).catch((value) => value);
    expect(error).toBeInstanceOf(HostPersonalityError);
    expect(error).toMatchObject({
      code: "TRANSACTION_RESTORED_FAILURE",
      status: 500,
      retryAfterSeconds: 2,
      transaction: { status: "restored_failure" },
    });
    expect(JSON.stringify(error.details)).not.toContain("failed safely");
  });

  it("rejects malformed successful responses as an invalid host contract", async () => {
    const client = new PersonalityHostClient({
      env,
      fetchImpl: (async () => new Response(JSON.stringify({ success: true, transaction: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    });
    await expect(client.inspectTransaction(
      workspace,
      "personality:fixture:attempt:1",
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
