import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRtxBrowserSession,
  startRtxBrowserSession,
  stopRtxBrowserSession,
} from "@/lib/rtx/browser-sessions";

const baseEnv = {
  RTX_APP_ID: "app-test",
  RTX_API_BASE_URL: "http://127.0.0.1:3101",
};
const devEnv = { ...baseEnv, SIGNALS_INSTANCE: "dev" };

function okFetch() {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ success: true }), { status: 200 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

type SessionCall = (
  sessionName: string | undefined,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
) => Promise<unknown>;

const calls: Array<[string, SessionCall]> = [
  ["create", (sessionName, env, fetchImpl) => createRtxBrowserSession({ sessionName }, env, fetchImpl)],
  ["start", (sessionName, env, fetchImpl) => startRtxBrowserSession({ sessionName }, env, fetchImpl)],
  ["stop", (sessionName, env, fetchImpl) => stopRtxBrowserSession(sessionName, env, fetchImpl)],
];

describe("RTX browser-session lifecycle on a Dev instance (ADR-541-5)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(calls)("%s refuses signals-publish with no RTX request", async (_name, call) => {
    const fetchImpl = okFetch();
    await expect(call("signals-publish", devEnv, fetchImpl)).rejects.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
      effect: "browser-session.publish",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(calls)("%s matches the publish name the way RTX lookups do", async (_name, call) => {
    const fetchImpl = okFetch();
    await expect(call("  Signals-Publish ", devEnv, fetchImpl)).rejects.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(calls.slice(0, 2))(
    "%s refuses an omitted name, which defaults to signals-publish",
    async (_name, call) => {
      const fetchImpl = okFetch();
      await expect(call(undefined, devEnv, fetchImpl)).rejects.toMatchObject({
        code: "DEV_INSTANCE_GUARD",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("stop refuses its default name, signals-publish", async () => {
    const fetchImpl = okFetch();
    await expect(stopRtxBrowserSession(undefined, devEnv, fetchImpl)).rejects.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(calls)("%s still proceeds for another session name (signals-x-anon)", async (name, call) => {
    const fetchImpl = okFetch();
    await expect(call("signals-x-anon", devEnv, fetchImpl)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]?.[0])).toContain(`/cli/${name}-browser-session`);
  });

  it.each(calls)("%s refuses signals-publish when only the process is a dev instance", async (_name, call) => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    const fetchImpl = okFetch();
    await expect(call("signals-publish", baseEnv, fetchImpl)).rejects.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(calls)("%s manages signals-publish unchanged on a canonical instance", async (_name, call) => {
    const fetchImpl = okFetch();
    await expect(call("signals-publish", baseEnv, fetchImpl)).resolves.toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
