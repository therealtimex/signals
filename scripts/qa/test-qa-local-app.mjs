#!/usr/bin/env node
/**
 * Tests for qa-local-app.mjs against a mock realtimex-pp-cli, a fixture RealTimeX database, and a
 * real HTTP server standing in for the QA app's /api/health. Nothing here reaches a RealTimeX host.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_SIGNALS_APP_ID,
  canonicalConfigProblems,
  canonicalSignalsRepoRoot,
  defaultQaDataDir,
  isCanonicalSignalsDataDir,
  qaReceiptPath,
  qaTemporaryRoot,
} from "./signals-qa-local-app.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const orchestrator = join(scriptDir, "qa-local-app.mjs");
const canonicalRepo = canonicalSignalsRepoRoot(scriptDir);

// The packaged host stores the expanded home path; both spellings are canonical.
assert.equal(isCanonicalSignalsDataDir("~/.signals"), true);
assert.equal(isCanonicalSignalsDataDir("/home/tester/.signals", "/home/tester"), true);
assert.equal(isCanonicalSignalsDataDir("/home/tester/.signals/", "/home/tester"), true);
assert.equal(isCanonicalSignalsDataDir("/home/other/.signals", "/home/tester"), false);
assert.equal(isCanonicalSignalsDataDir("/private/tmp/signals-qa-issue-1-data", "/home/tester"), false);
assert.equal(isCanonicalSignalsDataDir(".signals", "/home/tester"), false);
assert.equal(isCanonicalSignalsDataDir("", "/home/tester"), false);
assert.deepEqual(
  canonicalConfigProblems(
    {
      id: CANONICAL_SIGNALS_APP_ID,
      display_name: "Signals",
      config: JSON.stringify({
        command: "/node/bin/npm",
        args: ["run", "dev"],
        working_dir: "/repo/signals",
        env: { SIGNALS_DATA_DIR: "/home/tester/.signals" },
      }),
    },
    "/repo/signals",
    "/home/tester",
  ),
  [],
);

const root = mkdtempSync(join(tmpdir(), "signals-qa-orchestrator-test-"));
const repo = join(root, "repo");
const worktree = join(root, "worktree");
const statePath = join(root, "local-apps.json");
const mockCli = join(root, "mock-realtimex-pp-cli.mjs");
const dbPath = join(root, "realtimex.db");
const baseIssue = Number(String(Date.now()).slice(-8));
const issues = [];
const nextIssue = () => {
  const issue = String(baseIssue + issues.length);
  issues.push(issue);
  return issue;
};
const sessionPath = (issue) =>
  join(qaTemporaryRoot(), `signals-qa-local-app-issue-${issue}.session.json`);

function canonicalConfig(overrides = {}) {
  return {
    command: "/node/bin/npm",
    args: ["run", "dev"],
    working_dir: canonicalRepo,
    port: 3010,
    home_url: "http://localhost:{port}/dashboard",
    env: { HOSTNAME: "127.0.0.1", PORT: "3010", SIGNALS_DATA_DIR: join(homedir(), ".signals") },
    ...overrides,
  };
}

function writeCanonicalRow(config) {
  const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;
  execFileSync("sqlite3", [
    dbPath,
    `delete from local_apps; insert into local_apps values (${sql(CANONICAL_SIGNALS_APP_ID)}, ` +
      `'Signals', 'signals', ${sql(JSON.stringify(config))}, NULL, 'running');`,
  ]);
}

function resetMockState(extraApps = []) {
  writeFileSync(
    statePath,
    JSON.stringify({
      apps: [
        { id: CANONICAL_SIGNALS_APP_ID, displayName: "Signals", tags: [], persistedStatus: "running" },
        ...extraApps,
      ],
    }),
  );
}

function mockApps() {
  return JSON.parse(readFileSync(statePath, "utf8")).apps;
}

function run(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [orchestrator, ...args], {
      env: {
        ...process.env,
        MOCK_LOCAL_APPS_STATE: statePath,
        SIGNALS_QA_POLL_MS: "50",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      resolveRun({ status, stdout, stderr, json });
    });
  });
}

function healthServer() {
  return new Promise((resolveServer) => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === "/api/health" ? 200 : 404, {
        "content-type": "application/json",
      });
      response.end('{"ok":true}');
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function closedPort() {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const close = (server) => new Promise((resolveClose) => server.close(resolveClose));
const common = (issue) => ["--issue", issue, "--cli", mockCli, "--db", dbPath];

try {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "qa-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Signals QA Test"], { cwd: repo });
  writeFileSync(join(repo, "package.json"), '{ "name": "@realtimex/signals", "private": true }\n');
  execFileSync("git", ["add", "package.json"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", "-b", `issue-${baseIssue}`, worktree], {
    cwd: repo,
    stdio: "ignore",
  });

  execFileSync("sqlite3", [
    dbPath,
    "create table local_apps (id text primary key, display_name text, name text, config text, tags text, status text);",
  ]);
  writeCanonicalRow(canonicalConfig());

  writeFileSync(
    mockCli,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.MOCK_LOCAL_APPS_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const command = args[0];
const value = (flag) => args[args.indexOf(flag) + 1];
const save = () => writeFileSync(statePath, JSON.stringify(state));
const find = (id) => state.apps.find((app) => app.id === id);
if (process.env.MOCK_REFUSE === "1") {
  console.error('Error: GET /' + command + ' returned HTTP 401: {"error":"Invalid terminal session token.","code":"TERMINAL_SESSION_NOT_ACTIVE"}');
  process.exit(4);
}
let results;
if (command === "list-local-apps") {
  results = { apps: state.apps };
} else if (command === "create-local-app") {
  const app = {
    id: "qa-app-" + Date.now(),
    displayName: value("--display-name"),
    tags: value("--tags").split(","),
    env: JSON.parse(value("--env")),
    persistedStatus: "stopped",
    runtime: { status: "stopped" },
  };
  state.apps.push(app);
  save();
  results = { app };
} else if (command === "start-local-app") {
  const app = find(args[1]);
  const startTime = Date.now();
  app.persistedStatus = "running";
  // Like the packaged host for a port-less app: running, but runningPort unknown for now.
  const runningPort = process.env.MOCK_NO_PORT === "1" ? null : Number(process.env.MOCK_PORT);
  app.runtime = { status: process.env.MOCK_STATUS || "running", runningPort, startTime };
  if (process.env.MOCK_LOCK_PID) {
    const lockDir = app.env.SIGNALS_QA_WORKTREE + "/.next/dev";
    mkdirSync(lockDir, { recursive: true });
    const port = Number(process.env.MOCK_PORT);
    writeFileSync(lockDir + "/lock", JSON.stringify({ pid: Number(process.env.MOCK_LOCK_PID), port, appUrl: "http://localhost:" + port, startedAt: startTime + 300 }));
  }
  save();
  results = { success: true, appId: args[1] };
} else if (command === "get-local-app-status") {
  results = { success: true, appId: args[1], runtime: find(args[1])?.runtime ?? null };
} else if (command === "get-local-app-logs") {
  results = { success: true, logs: [{ type: "stderr", content: "\\u001b[31mboom: port in use\\u001b[39m", timestamp: 1 }] };
} else if (command === "stop-local-app") {
  const app = find(args[1]);
  app.persistedStatus = "stopped";
  app.runtime = { status: "stopped" };
  save();
  results = { success: true, appId: args[1] };
} else if (command === "delete-local-app") {
  state.apps = state.apps.filter((app) => app.id !== args[1]);
  save();
  results = { success: true, appId: args[1] };
} else {
  console.error("Unexpected mock command: " + command);
  process.exit(2);
}
console.log(JSON.stringify({ meta: { source: "mock" }, results }));
`,
  );
  chmodSync(mockCli, 0o755);

  // Usage.
  assert.equal((await run(["--help"])).status, 0);
  const unknown = await run(["launch", "--issue", "1"]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.json.errorCode, "USAGE");

  // A host that refuses this identity fails before anything is created.
  resetMockState();
  const refusedIssue = nextIssue();
  const refused = await run(["up", ...common(refusedIssue), "--worktree", worktree], {
    MOCK_REFUSE: "1",
  });
  assert.equal(refused.status, 1);
  assert.equal(refused.json.errorCode, "LOCAL_APP_MANAGEMENT_REFUSED");
  assert.equal(existsSync(qaReceiptPath(refusedIssue)), false);

  // The primary checkout is never a QA target.
  const primary = await run(["up", ...common(nextIssue()), "--worktree", repo]);
  assert.equal(primary.json.errorCode, "WORKTREE_INVALID");

  // A live `next dev` lock in the worktree blocks provisioning; nothing is created.
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "next-server-lock-holder"]);
  mkdirSync(join(worktree, ".next", "dev"), { recursive: true });
  writeFileSync(
    join(worktree, ".next", "dev", "lock"),
    JSON.stringify({ pid: holder.pid, port: 4999, appUrl: "http://localhost:4999" }),
  );
  const lockIssue = nextIssue();
  const locked = await run(["up", ...common(lockIssue), "--worktree", worktree]);
  holder.kill();
  await new Promise((resolveExit) => holder.once("exit", resolveExit));
  assert.equal(locked.json.errorCode, "NEXT_DEV_ALREADY_RUNNING");
  assert.equal(locked.json.lock.pid, holder.pid);
  assert.equal(mockApps().length, 1);
  assert.equal(existsSync(qaReceiptPath(lockIssue)), false);

  // An issue app with no receipt is someone else's; up refuses to stack another on it.
  const strayIssue = nextIssue();
  resetMockState([
    {
      id: "stray-qa-app",
      displayName: `Signals issue-${strayIssue} QA`,
      tags: ["signals", "qa", "ephemeral", `issue-${strayIssue}`],
      persistedStatus: "stopped",
    },
  ]);
  const stray = await run(["up", ...common(strayIssue), "--worktree", worktree]);
  assert.equal(stray.json.errorCode, "QA_APP_EXISTS");
  assert.match(stray.json.next, /down --issue/);

  // Happy path: up -> reuse -> status -> down. The dead pid's lock left above must not block.
  resetMockState();
  const issue = nextIssue();
  let server = await healthServer();
  const port = server.address().port;
  const first = await run(["up", ...common(issue), "--worktree", worktree, "--loop-id", "loop-test"], {
    MOCK_PORT: String(port),
  });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.reused, false);
  assert.equal(first.json.host, "packaged");
  assert.equal(first.json.port, port);
  assert.equal(first.json.dashboardUrl, `http://127.0.0.1:${port}/dashboard`);
  assert.equal(first.json.dataDir, defaultQaDataDir(issue));
  const receipt = JSON.parse(readFileSync(qaReceiptPath(issue), "utf8"));
  assert.equal(receipt.baseUrl, "http://127.0.0.1:3001/cli");
  const session = JSON.parse(readFileSync(sessionPath(issue), "utf8"));
  assert.equal(session.canonicalRows[0].id, CANONICAL_SIGNALS_APP_ID);
  assert.equal(session.port, port);

  const again = await run(["up", ...common(issue), "--worktree", worktree], { MOCK_PORT: String(port) });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.json.reused, true);
  assert.equal(mockApps().filter((app) => app.id !== CANONICAL_SIGNALS_APP_ID).length, 1);

  const elsewhere = await run(["up", ...common(issue), "--worktree", worktree, "--host", "dev"]);
  assert.equal(elsewhere.json.errorCode, "QA_APP_EXISTS");

  const statusOut = await run(["status", ...common(issue)]);
  assert.equal(statusOut.json.present, true);
  assert.equal(statusOut.json.healthy, true);
  assert.equal(statusOut.json.port, port);

  await close(server);
  const downOut = await run(["down", ...common(issue)]);
  assert.equal(downOut.status, 0, downOut.stdout + downOut.stderr);
  assert.equal(downOut.json.hygiene, "pass");
  assert.equal(downOut.json.canonicalUnchanged, true);
  assert.equal(downOut.json.portReleased, true);
  assert.equal(downOut.json.appDeleted, true);
  assert.equal(existsSync(qaReceiptPath(issue)), false);
  assert.equal(existsSync(sessionPath(issue)), false);
  assert.equal(mockApps().length, 1);

  // A canonical record that changes while QA runs fails down and says not to restore it here.
  resetMockState();
  const changedIssue = nextIssue();
  server = await healthServer();
  const changedUp = await run(["up", ...common(changedIssue), "--worktree", worktree], {
    MOCK_PORT: String(server.address().port),
  });
  assert.equal(changedUp.status, 0, changedUp.stdout + changedUp.stderr);
  writeCanonicalRow(canonicalConfig({ env: { ...canonicalConfig().env, PORT: "3999" } }));
  await close(server);
  const changedDown = await run(["down", ...common(changedIssue)]);
  assert.equal(changedDown.status, 1);
  assert.equal(changedDown.json.errorCode, "CANONICAL_CHANGED");
  assert.deepEqual(changedDown.json.changedFields, ["config.env.PORT"]);
  assert.match(changedDown.json.next, /Do not run --restore-canonical/);
  assert.equal(existsSync(sessionPath(changedIssue)), true);
  writeCanonicalRow(canonicalConfig());
  rmSync(sessionPath(changedIssue), { force: true });

  // An app that runs but never answers /api/health times out with its logs.
  resetMockState();
  const silentIssue = nextIssue();
  const silent = await run(
    ["up", ...common(silentIssue), "--worktree", worktree, "--timeout-ms", "1500"],
    { MOCK_PORT: String(await closedPort()) },
  );
  assert.equal(silent.status, 1);
  assert.equal(silent.json.errorCode, "HEALTH_TIMEOUT");
  assert.deepEqual(silent.json.logs, ["err boom: port in use"]);
  assert.match(silent.json.next, /down --issue/);
  const silentDown = await run(["down", ...common(silentIssue)]);
  assert.equal(silentDown.status, 0, silentDown.stdout + silentDown.stderr);

  // A crash during startup is reported immediately, not after the timeout.
  resetMockState();
  const crashIssue = nextIssue();
  const crashed = await run(["up", ...common(crashIssue), "--worktree", worktree], {
    MOCK_PORT: "1",
    MOCK_STATUS: "crashed",
  });
  assert.equal(crashed.json.errorCode, "START_FAILED");
  assert.equal((await run(["down", ...common(crashIssue)])).status, 0);

  // The packaged host reports runningPort late for a port-less app. The worktree's Next lock,
  // written when the dev server binds, supplies the port, and down still checks it is released.
  resetMockState();
  const lockPortIssue = nextIssue();
  server = await healthServer();
  const lockPort = server.address().port;
  const devServer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "next-server-qa-app"]);
  const viaLock = await run(["up", ...common(lockPortIssue), "--worktree", worktree], {
    MOCK_PORT: String(lockPort),
    MOCK_NO_PORT: "1",
    MOCK_LOCK_PID: String(devServer.pid),
  });
  assert.equal(viaLock.status, 0, viaLock.stdout + viaLock.stderr);
  assert.equal(viaLock.json.port, lockPort);
  assert.equal(viaLock.json.portSource, "next-lock");
  const viaLockStatus = await run(["status", ...common(lockPortIssue)]);
  assert.equal(viaLockStatus.json.healthy, true);
  assert.equal(viaLockStatus.json.portSource, "next-lock");
  await close(server);
  devServer.kill();
  await new Promise((resolveExit) => devServer.once("exit", resolveExit));
  const viaLockDown = await run(["down", ...common(lockPortIssue)]);
  assert.equal(viaLockDown.status, 0, viaLockDown.stdout + viaLockDown.stderr);
  assert.equal(viaLockDown.json.port, lockPort);
  assert.equal(viaLockDown.json.portReleased, true);

  // Running with no port from either source is its own failure, not a health timeout.
  resetMockState();
  const noPortIssue = nextIssue();
  const noPort = await run(
    ["up", ...common(noPortIssue), "--worktree", worktree, "--timeout-ms", "1000"],
    { MOCK_PORT: "1", MOCK_NO_PORT: "1" },
  );
  assert.equal(noPort.json.errorCode, "PORT_UNKNOWN");
  assert.equal((await run(["down", ...common(noPortIssue)])).status, 0);

  console.log("qa-local-app orchestrator: OK");
} finally {
  for (const issue of issues) {
    rmSync(qaReceiptPath(issue), { force: true });
    rmSync(sessionPath(issue), { force: true });
    rmSync(defaultQaDataDir(issue), { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}
