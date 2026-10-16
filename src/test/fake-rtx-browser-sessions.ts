import liveList from "@/lib/rtx/host-fixtures/list-browser-sessions.live.json";

export type FakeRtxSession = { sessionName: string; guardrails?: Record<string, unknown> };
export type FakeRtxCall = { path: string; body: Record<string, unknown> | null };

export type FakeRtxOptions = {
  /** `create-browser-session` answers 500 with this RealTimeX error. */
  createFails?: string;
  /** `create-browser-session` answers success but changes nothing. */
  createIgnored?: boolean;
  /** `list-browser-sessions` can't be reached. */
  listFails?: boolean;
  /** Runs inside `create-browser-session`, before RealTimeX applies it. */
  onCreate?: (body: Record<string, unknown> | null) => void;
};

/**
 * A RealTimeX stand-in for the browser-session CLI routes. It keeps session records and applies
 * `create-browser-session` the way RealTimeX does (ADR-547-1, F1): each guardrail key in the
 * request replaces the stored one, and absent keys are kept. Seeded from the live capture in
 * `src/lib/rtx/host-fixtures/list-browser-sessions.live.json`.
 */
export function fakeRtxBrowserSessions(options: FakeRtxOptions = {}) {
  const sessions: FakeRtxSession[] = structuredClone(liveList.sessions) as FakeRtxSession[];
  const calls: FakeRtxCall[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ path, body });
    const reply = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (path === "/cli/list-browser-sessions") {
      if (options.listFails) throw new TypeError("fetch failed");
      return reply(200, { success: true, sessions });
    }
    if (path === "/cli/create-browser-session") {
      options.onCreate?.(body);
      if (options.createFails) return reply(500, { success: false, error: options.createFails });
      if (options.createIgnored) return reply(200, { success: true, created: false });
      const name = String(body?.sessionName);
      let session = sessions.find((entry) => entry.sessionName === name);
      if (!session) {
        session = { sessionName: name, guardrails: {} };
        sessions.push(session);
      }
      session.guardrails = { ...session.guardrails, ...(body?.guardrails as object) };
      return reply(200, { success: true, created: false });
    }
    return reply(404, { success: false, error: `unexpected ${path}` });
  };

  const guardrailsOf = (sessionName: string) =>
    sessions.find((entry) => entry.sessionName === sessionName)?.guardrails;

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, sessions, guardrailsOf };
}
