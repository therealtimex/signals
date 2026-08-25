import {
  listRtxBrowserSessions,
  stopRtxBrowserSession,
  type RtxBrowserSessionEntry,
} from "@/lib/rtx/browser-sessions";
import type { EnvLike } from "@/lib/rtx/env";
import {
  terminateTerminalRuntimeSession,
  waitForTerminalSessionIdle,
  type TerminateTerminalSessionResult,
} from "@/lib/rtx/runtime-sessions";

export type BrowserSessionTeardownResult = {
  stopped: string[];
  failed: Array<{ sessionName: string; error: string }>;
};

export type AgentLaneResourceTeardownResult = {
  terminal: TerminateTerminalSessionResult;
  browser: BrowserSessionTeardownResult;
};

function isBrowserSessionRunning(entry: RtxBrowserSessionEntry): boolean {
  if (entry.running === true) return true;
  const status = entry.runtime?.status?.trim().toLowerCase();
  return status === "running" || status === "active";
}

export async function stopRunningRtxBrowserSessions(
  input: {
    sessionNames?: string[];
    stopAllRunning?: boolean;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<BrowserSessionTeardownResult> {
  const result: BrowserSessionTeardownResult = { stopped: [], failed: [] };

  if (!input.stopAllRunning && (!input.sessionNames || input.sessionNames.length === 0)) {
    return result;
  }

  let sessions: RtxBrowserSessionEntry[];
  try {
    sessions = await listRtxBrowserSessions(env, fetchImpl);
  } catch (error) {
    result.failed.push({
      sessionName: "*",
      error: error instanceof Error ? error.message : "Failed to list browser sessions",
    });
    return result;
  }

  const requestedNames = new Set<string>();
  for (const name of input.sessionNames ?? []) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed) requestedNames.add(trimmed);
  }

  const targets = sessions.filter((entry) => {
    if (!entry.sessionName?.trim() || !isBrowserSessionRunning(entry)) return false;
    if (input.stopAllRunning) return true;
    return requestedNames.has(entry.sessionName.trim().toLowerCase());
  });

  const seen = new Set<string>();
  for (const entry of targets) {
    const sessionName = entry.sessionName.trim();
    const key = sessionName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await stopRtxBrowserSession(sessionName, env, fetchImpl);
      result.stopped.push(sessionName);
    } catch (error) {
      result.failed.push({
        sessionName,
        error: error instanceof Error ? error.message : "Failed to stop browser session",
      });
    }
  }

  return result;
}

export async function releaseAgentLaneResources(
  input: {
    terminalSessionId?: string | null;
    browserSessionNames?: string[];
    stopAllRunningBrowserSessions?: boolean;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<AgentLaneResourceTeardownResult> {
  const [terminal, browser] = await Promise.all([
    terminateTerminalRuntimeSession(input.terminalSessionId, env, fetchImpl),
    stopRunningRtxBrowserSessions(
      {
        sessionNames: input.browserSessionNames,
        stopAllRunning: input.stopAllRunningBrowserSessions,
      },
      env,
      fetchImpl
    ),
  ]);

  return { terminal, browser };
}

export type ScheduledTerminalSessionRelease = {
  scheduled: true;
  sessionId: string | null;
};

export function scheduleTerminalSessionRelease(
  terminalSessionId: string | null | undefined,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): ScheduledTerminalSessionRelease {
  const sessionId = terminalSessionId?.trim() || null;
  if (!sessionId) {
    return { scheduled: true, sessionId: null };
  }

  setImmediate(() => {
    void (async () => {
      const idle = await waitForTerminalSessionIdle(sessionId, { env, fetchImpl });
      if (!idle.idle) {
        console.warn(
          `[scheduleTerminalSessionRelease] ${sessionId}: ${idle.reason} Terminating anyway.`
        );
      }

      const result = await terminateTerminalRuntimeSession(sessionId, env, fetchImpl);
      if (!result.success) {
        console.warn(
          `[scheduleTerminalSessionRelease] Failed for ${sessionId}: ${result.error}`
        );
      }
    })();
  });

  return { scheduled: true, sessionId };
}

export function formatDeferredTerminalTeardownNote(input: {
  terminal: ScheduledTerminalSessionRelease;
  browser: BrowserSessionTeardownResult;
}): string {
  const parts: string[] = [];

  if (input.terminal.sessionId) {
    parts.push("Terminal session release scheduled.");
  }

  if (input.browser.stopped.length > 0) {
    parts.push(`Browser sessions stopped: ${input.browser.stopped.join(", ")}.`);
  }

  if (input.browser.failed.length > 0) {
    const summary = input.browser.failed
      .map((failure) => `${failure.sessionName} (${failure.error})`)
      .join("; ");
    parts.push(`Browser session teardown issues: ${summary}.`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function formatAgentLaneTeardownNote(result: AgentLaneResourceTeardownResult): string {
  const parts: string[] = [];

  if (result.terminal.success) {
    if (result.terminal.terminated) {
      parts.push("Terminal session released.");
    }
  } else {
    parts.push(`Terminal session teardown failed: ${result.terminal.error}.`);
  }

  if (result.browser.stopped.length > 0) {
    parts.push(`Browser sessions stopped: ${result.browser.stopped.join(", ")}.`);
  }

  if (result.browser.failed.length > 0) {
    const summary = result.browser.failed
      .map((failure) => `${failure.sessionName} (${failure.error})`)
      .join("; ");
    parts.push(`Browser session teardown issues: ${summary}.`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}
