import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRtxBrowserSession,
  RtxNavigationBlockedError,
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

describe("RTX navigation denials (#547, ADR-547-7)", () => {
  /** RealTimeX's guardrail result (cliBrowserRuntimeService.cjs buildCliBrowserGuardrailBlockedResult). */
  function denialFetch(status: number, reason: string, targetOrigin: string | null, error: string) {
    return vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          reason,
          error,
          guardrail: {
            action: "create-tab",
            policy: "session-guardrail",
            targetOrigin,
            primaryOrigin: "https://x.com",
            guardrails: { mode: "unrestricted", allowedOrigins: ["https://x.com"] },
          },
        }),
        { status },
      ),
    ) as unknown as typeof fetch;
  }

  it.each([503, 403])("types a not-allowed denial by its reason, not its HTTP %i", async (status) => {
    const fetchImpl = denialFetch(
      status,
      "guardrail-origin-not-allowed",
      "https://lnkd.in",
      "The RealTimeX Browser session does not allow https://lnkd.in.",
    );

    const failure = await startRtxBrowserSession(
      { sessionName: "brand-x", url: "https://lnkd.in/p/ggz83Nmd" },
      baseEnv,
      fetchImpl,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RtxNavigationBlockedError);
    expect((failure as RtxNavigationBlockedError).code).toBe("RTX_NAVIGATION_BLOCKED");
    expect((failure as RtxNavigationBlockedError).denial).toEqual({
      reason: "guardrail-origin-not-allowed",
      action: "create-tab",
      sessionName: "brand-x",
      deniedOrigin: "https://lnkd.in",
      requestedUrl: "https://lnkd.in/p/ggz83Nmd",
      primaryOrigin: "https://x.com",
    });
    expect((failure as Error).message).toContain("does not allow https://lnkd.in.");
  });

  it("types an anchored-session mismatch too, keeping today's message", async () => {
    const fetchImpl = denialFetch(
      503,
      "guardrail-origin-mismatch",
      "https://www.linkedin.com",
      "The RealTimeX Browser session is locked to https://x.com.",
    );

    const failure = await startRtxBrowserSession(
      { sessionName: "brand-x", url: "https://www.linkedin.com/feed/" },
      baseEnv,
      fetchImpl,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RtxNavigationBlockedError);
    expect((failure as RtxNavigationBlockedError).denial.reason).toBe("guardrail-origin-mismatch");
    expect((failure as Error).message).toMatch(/locked to https:\/\/x\.com\..*signals-publish/s);
  });

  it("keeps other failures as plain errors", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: "Session registry is busy." }), {
        status: 503,
      }),
    ) as unknown as typeof fetch;

    const failure = await startRtxBrowserSession({ sessionName: "brand-x" }, baseEnv, fetchImpl).catch(
      (error: unknown) => error,
    );

    expect(failure).not.toBeInstanceOf(RtxNavigationBlockedError);
    expect((failure as Error).message).toBe("Session registry is busy.");
  });
});
