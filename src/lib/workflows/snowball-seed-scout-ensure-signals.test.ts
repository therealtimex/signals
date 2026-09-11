import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A RealTimeX restart leaves the Signals Local App stopped, and the heartbeat
 * shows the scout's shell as completed whatever it prints. These run the real
 * scout scripts against a stub `realtimex-pp-cli` whose `start-local-app` brings
 * up a real /api/health, so the start-and-wait path is exercised end to end.
 */
const SCOUT_DIR = join(process.cwd(), "scripts", "snowball-seed-scout");
const APP_ID = "47e45f71-3279-42f5-8e95-731de01b6eae";

const STUB_CLI = `#!/usr/bin/env bash
echo "$1" >> "$STUB_CALLS"
# The real CLI warns on stderr before printing JSON; callers must read stdout only.
echo "warning: not cached locally" >&2
case "$1" in
  get-local-app)
    printf '{"meta":{"source":"live"},"results":{"app":{"id":"%s","enabled":%s,"persistedStatus":"stopped","runtime":{"status":"stopped"}}}}\\n' "$2" "\${STUB_ENABLED:-true}"
    ;;
  start-local-app)
    if [ -n "\${STUB_HEALTH_DIR:-}" ]; then
      nohup python3 -m http.server "$STUB_PORT" --bind 127.0.0.1 --directory "$STUB_HEALTH_DIR" >/dev/null 2>&1 &
      echo $! > "$STUB_SERVER_PID"
    fi
    printf '{"results":{"success":true}}\\n'
    ;;
  *)
    exit 1
    ;;
esac
`;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let root: string;
let port: number;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "signals-scout-ensure-"));
  port = await freePort();

  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "realtimex-pp-cli"), STUB_CLI);
  chmodSync(join(root, "bin", "realtimex-pp-cli"), 0o755);

  mkdirSync(join(root, "health", "api"), { recursive: true });
  writeFileSync(join(root, "health", "api", "health"), '{"status":"ok"}');

  cpSync(SCOUT_DIR, join(root, "scout"), { recursive: true });
});

afterEach(() => {
  const pidFile = join(root, "server.pid");
  if (existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8").trim()));
    } catch {
      // already gone
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function stubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    STUB_CALLS: join(root, "calls.log"),
    STUB_PORT: String(port),
    STUB_SERVER_PID: join(root, "server.pid"),
    SCOUT_SIGNALS_START_TIMEOUT_SECONDS: "20",
    SCOUT_SIGNALS_POLL_SECONDS: "0.2",
    ...extra,
  };
  delete env.SIGNALS_BASE_URL;
  return env;
}

function calls(): string[] {
  const file = join(root, "calls.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
}

function writeScoutConfig(overrides: Record<string, unknown>): void {
  writeFileSync(
    join(root, "scout", "scout.json"),
    JSON.stringify({
      version: 1,
      signalsBaseUrl: `http://127.0.0.1:${port}`,
      platforms: ["x"],
      communities: [],
      searchQueries: [],
      intentKeywords: ["funding"],
      enabled: true,
      ...overrides,
    }),
  );
}

describe("snowball seed scout: Signals must be up before harvesting", () => {
  it("starts a stopped Signals through RealTimeX and waits for it to answer", () => {
    const result = spawnSync(
      "python3",
      [
        join(root, "scout", "lib", "resolve.py"),
        "ensure-signals",
        JSON.stringify({ signalsLocalAppId: APP_ID }),
        `http://127.0.0.1:${port}`,
      ],
      { encoding: "utf8", env: stubEnv({ STUB_HEALTH_DIR: join(root, "health") }) },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, started: true });
    expect(calls()).toEqual(["get-local-app", "start-local-app"]);
  });

  it("skips a run without browsing when Signals is disabled", () => {
    writeScoutConfig({ signalsLocalAppId: APP_ID });

    const result = spawnSync("bash", [join(root, "scout", "scout.sh")], {
      encoding: "utf8",
      env: stubEnv({ STUB_ENABLED: "false" }),
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      queued: 0,
      skipped: true,
      reason: "disabled",
    });
    expect(result.stderr).toContain("disabled in RealTimeX");
    // Nothing past the lookup: no start, no browser session.
    expect(calls()).toEqual(["get-local-app"]);
  });

  it("says plainly that Signals is down when it cannot start it", () => {
    writeScoutConfig({});

    const result = spawnSync("bash", [join(root, "scout", "scout.sh")], {
      encoding: "utf8",
      env: stubEnv(),
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      queued: 0,
      skipped: true,
      reason: "no_local_app_id",
    });
    expect(result.stderr).toContain(`Signals isn't running at http://127.0.0.1:${port}`);
    expect(calls()).toEqual([]);
  });
});
