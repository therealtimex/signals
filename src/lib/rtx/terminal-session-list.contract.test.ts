import { describe, expect, it } from "vitest";
import {
  listTerminalRuntimeSessions,
  resolveActiveTerminalSessionIdForThread,
} from "@/lib/rtx/runtime-sessions";

/**
 * Assert our terminal-session parser against a *live* RealTimeX host.
 *
 * `GET /cli/list-terminal-sessions` returns `workspaces` at the top level. We
 * read `results.workspaces`, an envelope the host has never sent, so the parser
 * returned zero sessions for every real response — silently. Nothing caught it:
 * the unit mocks described the same invented envelope the parser read, so our
 * output agreed with our input while both disagreed with the runtime. The cost
 * was the whole deferred-teardown path (#297): `resolveActiveTerminalSession-
 * IdForThread` resolved null so the orchestrator terminal was never closed, and
 * `waitForTerminalSessionIdle` called sessions it could not see "idle". See #295.
 *
 * A captured-payload fixture (`runtime-sessions.test.ts`) pins today's shape.
 * This pins the *live* one, so the next drift fails here instead of in a thread
 * that quietly never tears down.
 *
 * Like `contract:heartbeat`, this asserts against something outside this repo,
 * so it lives in the `contract` project and never runs in the default gate. Run
 * it with `npm run contract:terminal-sessions` against a running RealTimeX.
 *
 * It skips when no host is reachable, and fails when `RTX_API_BASE_URL` is set
 * but unusable, so an intentional run cannot silently degrade into a skip.
 */

const SIGNALS_BASE_URL = process.env.SIGNALS_BASE_URL?.trim() || "http://localhost:3010";
const BASE_CANDIDATES = ["http://127.0.0.1:3001", "http://127.0.0.1:3101"];

type Host = { apiBase: string; appId: string };

async function readAppId(): Promise<string | null> {
  const explicit = process.env.RTX_APP_ID?.trim();
  if (explicit) return explicit;

  // A running Signals reports the app id it registered with on /api/health.
  try {
    const response = await fetch(`${SIGNALS_BASE_URL}/api/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as { rtx?: { appId?: string } };
    return body.rtx?.appId?.trim() || null;
  } catch {
    return null;
  }
}

async function reachable(apiBase: string, appId: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/cli/list-terminal-sessions?includeClosed=false`, {
      headers: { "x-app-id": appId },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { success?: boolean };
    return body.success !== false;
  } catch {
    return false;
  }
}

async function resolveHost(): Promise<Host | null> {
  const appId = await readAppId();
  const explicitBase = process.env.RTX_API_BASE_URL?.trim();

  if (explicitBase) {
    if (!appId) {
      throw new Error(
        "RTX_API_BASE_URL is set but no app id is available. Set RTX_APP_ID, or start Signals so " +
          `${SIGNALS_BASE_URL}/api/health can report one.`
      );
    }
    if (!(await reachable(explicitBase, appId))) {
      throw new Error(
        `RTX_API_BASE_URL=${explicitBase} did not answer GET /cli/list-terminal-sessions for app ` +
          `${appId}. Point it at a running RealTimeX, or unset it to auto-discover.`
      );
    }
    return { apiBase: explicitBase, appId };
  }

  if (!appId) return null;
  for (const candidate of BASE_CANDIDATES) {
    if (await reachable(candidate, appId)) return { apiBase: candidate, appId };
  }
  return null;
}

const host = await resolveHost();

describe.skipIf(!host)("list-terminal-sessions live contract", () => {
  const env = { RTX_APP_ID: host?.appId, RTX_API_BASE_URL: host?.apiBase };

  it("parses every session the host actually reports", async () => {
    const raw = (await fetch(
      `${host!.apiBase}/cli/list-terminal-sessions?includeClosed=false`,
      { headers: { "x-app-id": host!.appId } }
    ).then((response) => response.json())) as Record<string, unknown>;

    // The shape the parser depends on, asserted directly so a rename of this
    // key fails with the reason rather than as an empty-list mystery.
    expect(Array.isArray(raw.workspaces)).toBe(true);

    const groups = raw.workspaces as Array<{
      workspaceSlug: string;
      threads: Array<{ threadSlug: string; sessions: Array<{ id: string }> }>;
    }>;
    const hostSessions = groups.flatMap((workspace) =>
      workspace.threads.flatMap((thread) =>
        thread.sessions.map((session) => ({
          id: session.id,
          workspaceSlug: workspace.workspaceSlug,
          threadSlug: thread.threadSlug,
        }))
      )
    );

    // A vacuous pass is the failure mode this probe exists to prevent.
    expect(
      hostSessions.length,
      "The host reported no open terminal sessions, so this probe would pass without " +
        "proving anything. Open one terminal session in RealTimeX and re-run."
    ).toBeGreaterThan(0);

    const parsed = await listTerminalRuntimeSessions({ includeClosed: false }, env);
    expect(parsed.map((session) => session.id)).toEqual(hostSessions.map((s) => s.id));

    // The teardown path resolves by thread, which the host filters server-side.
    const first = hostSessions[0];
    await expect(
      resolveActiveTerminalSessionIdForThread(first.workspaceSlug, first.threadSlug, env)
    ).resolves.toBe(first.id);
  });
});
