import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseXContentTabsFromSession,
  type BrowserTabRecord,
} from "@/lib/browser/rtx-publish/desktop-browser-client";

const execFileAsync = promisify(execFile);

export type PpCliJson = {
  results?: Record<string, unknown>;
  error?: string;
};

export type BrowserSessionRecord = {
  sessionName: string;
  remoteDebugPort: number;
  running: boolean;
  status?: string;
  tabs?: BrowserTabRecord[];
};

export type PpCliRunner = (args: string[]) => Promise<PpCliJson>;

/** Run realtimex-pp-cli with agent-friendly defaults. Injectable for tests. */
export async function runPpCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<PpCliJson> {
  const bin = env.REALTIMEX_PP_CLI?.trim() || "realtimex-pp-cli";
  const { stdout } = await execFileAsync(
    bin,
    [...args, "--agent", "--no-input", "--yes"],
    {
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    }
  );

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("realtimex-pp-cli returned empty output");
  }

  try {
    return JSON.parse(trimmed) as PpCliJson;
  } catch {
    throw new Error(`realtimex-pp-cli returned non-JSON output: ${trimmed.slice(0, 200)}`);
  }
}

/** Parse list-browser-sessions response into typed records. */
export function parseBrowserSessions(payload: PpCliJson | Record<string, unknown>): BrowserSessionRecord[] {
  const record = payload as Record<string, unknown>;
  const sessions =
    (Array.isArray(record.sessions) ? record.sessions : null) ??
    (record.results &&
    typeof record.results === "object" &&
    Array.isArray((record.results as Record<string, unknown>).sessions)
      ? (record.results as Record<string, unknown>).sessions
      : null);
  if (!Array.isArray(sessions)) return [];

  return sessions
    .map((raw): BrowserSessionRecord | null => {
      if (!raw || typeof raw !== "object") return null;
      const record = raw as Record<string, unknown>;
      const sessionName = typeof record.sessionName === "string" ? record.sessionName : null;
      const port =
        typeof record.remoteDebugPort === "number"
          ? record.remoteDebugPort
          : typeof record.port === "number"
            ? record.port
            : null;
      if (!sessionName || port === null) return null;
      return {
        sessionName,
        remoteDebugPort: port,
        running: Boolean(record.running),
        status: typeof record.status === "string" ? record.status : undefined,
        tabs: parseXContentTabsFromSession(record),
      };
    })
    .filter((s): s is BrowserSessionRecord => s !== null);
}

/** Extract remoteDebugPort from create/start session responses. */
export function parseSessionPort(payload: PpCliJson | Record<string, unknown>): number | null {
  const record =
    payload.results && typeof payload.results === "object"
      ? (payload.results as Record<string, unknown>)
      : (payload as Record<string, unknown>);
  if (!record || typeof record !== "object") return null;

  if (typeof record.remoteDebugPort === "number") return record.remoteDebugPort;
  if (typeof record.port === "number") return record.port;

  const runtime = record.runtime;
  if (runtime && typeof runtime === "object") {
    const nested = runtime as Record<string, unknown>;
    if (typeof nested.remoteDebugPort === "number") return nested.remoteDebugPort;
    if (typeof nested.port === "number") return nested.port;
  }

  const session = record.session;
  if (session && typeof session === "object") {
    const nested = session as Record<string, unknown>;
    if (typeof nested.remoteDebugPort === "number") return nested.remoteDebugPort;
    if (typeof nested.port === "number") return nested.port;
  }

  return null;
}
