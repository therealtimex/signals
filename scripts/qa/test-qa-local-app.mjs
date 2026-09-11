#!/usr/bin/env node
/**
 * Tests for qa-local-app.mjs against a mock realtimex-pp-cli, a fixture RealTimeX database, and a
 * fake QA app: a child process serving /api/health that the mock stops like RealTimeX would.
 * Nothing here reaches a RealTimeX host. Every run sets REALTIMEX_PP_CLI to a tripwire, so a
 * command that falls back to the default CLI fails instead of talking to a live host.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IssueLockBusyError,
  acquireIssueLock,
  lockHolderAlive,
  processStartTime,
  releaseIssueLock,
  takeOverStaleLock,
} from "./qa-issue-lock.mjs";
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

// Issue lock: whole-file publish, stale and recycled-pid takeover, nonce-checked release.
{
  const lockDir = mkdtempSync(join(tmpdir(), "signals-qa-lock-test-"));
  const path = join(lockDir, "issue.lock");
  const busyBecause = (reason) => (error) =>
    error instanceof IssueLockBusyError && error.reason === reason;
  const takes = (content, secondsOld = 0) => {
    writeFileSync(path, content);
    if (secondsOld) {
      const then = Date.now() / 1000 - secondsOld;
      utimesSync(path, then, then);
    }
    acquireIssueLock(path, "up")();
  };
  try {
    const release = acquireIssueLock(path, "up");
    const mine = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(mine.pid, process.pid);
    assert.equal(mine.pidStart, processStartTime(process.pid));
    assert.throws(() => acquireIssueLock(path, "down"), busyBecause("held"));
    release();
    assert.equal(existsSync(path), false);

    // A dead pid is stale. A live pid whose start time differs was recycled, which only ps can
    // tell; without ps the pid decides alone and the lock counts as held.
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    takes(JSON.stringify({ pid: deadPid, action: "up" }));
    const recycled = { pid: process.pid, pidStart: "Mon Jan  1 00:00:00 2001", action: "up" };
    if (processStartTime(process.pid) !== null) takes(JSON.stringify(recycled));
    const noPs = mkdtempSync(join(tmpdir(), "signals-qa-no-ps-"));
    writeFileSync(join(noPs, "ps"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(noPs, "ps"), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${noPs}${delimiter}${savedPath}`;
    try {
      assert.equal(processStartTime(process.pid), null);
      assert.equal(lockHolderAlive(recycled), true);
    } finally {
      process.env.PATH = savedPath;
      rmSync(noPs, { recursive: true, force: true });
    }
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, pidStart: processStartTime(process.pid), action: "up" }),
    );
    assert.throws(() => acquireIssueLock(path, "up"), busyBecause("held"));

    // Content that names no real pid, `{}` included, counts as held while fresh and as stale once
    // old, the same as unparseable content.
    for (const content of ["{", "{}", '{"pid":"12"}', "null"]) {
      writeFileSync(path, content);
      assert.throws(() => acquireIssueLock(path, "up"), busyBecause("unreadable"));
      takes(content, 60);
    }

    // A link attempt follows the last allowed takeover, and a lock that keeps changing hands fails
    // as contention, not as an unreadable lock.
    const stale = JSON.stringify({ pid: deadPid, action: "up" });
    writeFileSync(path, stale);
    let restales = 1;
    const settle = () => {
      if (restales-- > 0) writeFileSync(path, stale);
    };
    acquireIssueLock(path, "up", { maxTakeovers: 2, afterTakeover: settle })();
    assert.equal(existsSync(path), false);
    writeFileSync(path, stale);
    assert.throws(
      () =>
        acquireIssueLock(path, "up", {
          maxTakeovers: 2,
          afterTakeover: () => writeFileSync(path, stale),
        }),
      (error) => busyBecause("contended")(error) && !/unreadable/.test(error.message),
    );
    rmSync(path, { force: true });

    // Takeover puts back a lock that changed after it was inspected, and removes one that did not.
    writeFileSync(path, "fresh-lock");
    takeOverStaleLock(path, "stale-lock-that-was-inspected");
    assert.equal(readFileSync(path, "utf8"), "fresh-lock");
    takeOverStaleLock(path, "fresh-lock");
    assert.equal(existsSync(path), false);

    // Release leaves a lock that belongs to someone else.
    writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: "someone-else" }));
    releaseIssueLock(path, "mine");
    assert.equal(existsSync(path), true);
    rmSync(path);
    assert.deepEqual(readdirSync(lockDir), []);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

// qa-local-app.mjs reads the canonical record with the sqlite3 CLI, so without it the lifecycle
// cannot run at all. Skip it the way test-signals-qa-local-app.mjs skips its sqlite section.
if (spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status !== 0) {
  console.log("qa-local-app orchestrator: SKIP lifecycle tests (sqlite3 CLI not found)");
  process.exit(0);
}

const canonicalRepo = canonicalSignalsRepoRoot(scriptDir);
const root = mkdtempSync(join(tmpdir(), "signals-qa-orchestrator-test-"));
const repo = join(root, "repo");
const worktree = join(root, "worktree");
const statePath = join(root, "local-apps.json");
const mockCli = join(root, "mock-realtimex-pp-cli.mjs");
const tripwireCli = join(root, "tripwire-realtimex-pp-cli.mjs");
const dbPath = join(root, "realtimex.db");
const baseIssue = Number(String(Date.now()).slice(-8));
const issues = [];
const children = new Set();
// The script promises a `next` on every failure; any run that breaks that lands here.
const failuresWithoutNext = [];

const nextIssue = () => {
  const issue = String(baseIssue + issues.length);
  issues.push(issue);
  return issue;
};
const sessionPath = (issue) =>
  join(qaTemporaryRoot(), `signals-qa-local-app-issue-${issue}.session.json`);
const lockPath = (issue) => join(qaTemporaryRoot(), `signals-qa-local-app-issue-${issue}.lock`);
const common = (issue) => ["--issue", issue, "--cli", mockCli, "--db", dbPath];
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
// What the fixture worktree's rtx-manifest.json requests, as Signals' does.
const requested = [
  "credentials.list",
  "credentials.use",
  "webhook.trigger",
  "llm.embed",
  "llm.chat",
  "desktop.browser",
  "desktop.runtime-sessions",
  "workspace.personality.write",
];

function track(child) {
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stopChild(child) {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
    child.once("exit", () => resolveStop());
    child.kill("SIGTERM");
  });
}

async function deadPid() {
  const child = track(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]));
  const { pid } = child;
  await stopChild(child);
  return pid;
}

// The command line contains "next", like the dev server that holds .next/dev/lock.
function fakeApp() {
  return new Promise((resolveApp, rejectApp) => {
    const child = track(
      spawn(process.execPath, [
        "-e",
        `const server = require("node:http").createServer((request, response) => {
           response.writeHead(request.url === "/api/health" ? 200 : 404);
           response.end("{}");
         });
         server.listen(0, "127.0.0.1", () => process.stdout.write(server.address().port + "\\n"));`,
        "next-server-fake-qa-app",
      ]),
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      // Plain write, not console.log: FORCE_COLOR would wrap a logged number in colour codes.
      const port = out.includes("\n") ? Number(out.match(/\d+/)?.[0]) : NaN;
      if (port) resolveApp({ child, pid: child.pid, port });
    });
    child.once("error", rejectApp);
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

const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

function writeCanonicalRow(config) {
  execFileSync("sqlite3", [
    dbPath,
    `delete from local_apps where id = ${sql(CANONICAL_SIGNALS_APP_ID)}; ` +
      "insert into local_apps (id, display_name, name, config, tags, status) values " +
      `(${sql(CANONICAL_SIGNALS_APP_ID)}, 'Signals', 'signals', ${sql(JSON.stringify(config))}, NULL, 'running');`,
  ]);
}

// Stands in for the user answering RealTimeX's dialog: RealTimeX records the decision in the QA
// app's row. Retries until the mock has created that row.
async function decidePermissions(issue, decision, { afterMs = 0 } = {}) {
  await sleep(afterMs);
  const metadata = sql(JSON.stringify({ permissions: decision }));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const changed = execFileSync(
      "sqlite3",
      [
        dbPath,
        `update local_apps set metadata = ${metadata} where display_name = 'Signals issue-${issue} QA'; select changes();`,
      ],
      { encoding: "utf8" },
    ).trim();
    if (changed !== "0") return;
    await sleep(100);
  }
  throw new Error(`No QA app row for issue ${issue} to record permissions on.`);
}

function resetMockState(extraApps = []) {
  execFileSync("sqlite3", [dbPath, `delete from local_apps where id != ${sql(CANONICAL_SIGNALS_APP_ID)};`]);
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

function editQaApp(issue, edit) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const app = state.apps.find((candidate) => candidate.displayName === `Signals issue-${issue} QA`);
  edit(app);
  writeFileSync(statePath, JSON.stringify(state));
}

function run(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = track(
      spawn(process.execPath, [orchestrator, ...args], {
        env: {
          ...process.env,
          MOCK_LOCAL_APPS_STATE: statePath,
          MOCK_DB: dbPath,
          REALTIMEX_PP_CLI: tripwireCli,
          SIGNALS_QA_POLL_MS: "50",
          ...env,
        },
      }),
    );
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
      if (json?.ok === false && !String(json.next || "").trim()) {
        failuresWithoutNext.push(`${args[0]} -> ${json.errorCode}`);
      }
      resolveRun({ status, stdout, stderr, json });
    });
  });
}

const detail = (result) => `${result.stdout}${result.stderr}`;

try {
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "qa-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Signals QA Test"], { cwd: repo });
  writeFileSync(join(repo, "package.json"), '{ "name": "@realtimex/signals", "private": true }\n');
  writeFileSync(join(repo, "rtx-manifest.json"), `${JSON.stringify({ permissions: requested })}\n`);
  execFileSync("git", ["add", "package.json", "rtx-manifest.json"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", "-b", `issue-${baseIssue}`, worktree], {
    cwd: repo,
    stdio: "ignore",
  });

  execFileSync("sqlite3", [
    dbPath,
    "create table local_apps (id text primary key, display_name text, name text, config text, tags text, status text, metadata text);",
  ]);
  writeCanonicalRow(canonicalConfig());

  writeFileSync(
    tripwireCli,
    `#!/usr/bin/env node
console.error("tripwire: a command fell back to the default realtimex-pp-cli");
process.exit(97);
`,
  );
  chmodSync(tripwireCli, 0o755);

  writeFileSync(
    mockCli,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.MOCK_LOCAL_APPS_STATE;
// RealTimeX keeps a row per Local App; the orchestrator reads its permission decisions there.
const sqlite = (statement) => execFileSync("sqlite3", [process.env.MOCK_DB, statement]);
const quote = (text) => "'" + String(text).replace(/'/g, "''") + "'";
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
  sqlite("insert into local_apps (id, display_name, name, tags, status, metadata) values (" + [app.id, app.displayName, "qa", JSON.stringify(app.tags), "stopped", "{}"].map(quote).join(", ") + ");");
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
  // RealTimeX stops the app's process; the fake app stands in for it.
  if (process.env.MOCK_APP_PID) {
    try {
      process.kill(Number(process.env.MOCK_APP_PID), "SIGTERM");
    } catch {
      // already gone
    }
  }
  results = { success: true, appId: args[1] };
} else if (command === "delete-local-app") {
  state.apps = state.apps.filter((app) => app.id !== args[1]);
  save();
  sqlite("delete from local_apps where id = " + quote(args[1]) + ";");
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
  assert.equal(existsSync(lockPath(refusedIssue)), false);

  // The primary checkout is never a QA target.
  const primary = await run(["up", ...common(nextIssue()), "--worktree", repo]);
  assert.equal(primary.json.errorCode, "WORKTREE_INVALID");

  // A live `next dev` lock in the worktree blocks provisioning; nothing is created.
  const holder = track(
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "next-server-lock-holder"]),
  );
  mkdirSync(join(worktree, ".next", "dev"), { recursive: true });
  writeFileSync(
    join(worktree, ".next", "dev", "lock"),
    JSON.stringify({ pid: holder.pid, port: 4999, appUrl: "http://localhost:4999" }),
  );
  const lockIssue = nextIssue();
  const locked = await run(["up", ...common(lockIssue), "--worktree", worktree]);
  await stopChild(holder);
  assert.equal(locked.json.errorCode, "NEXT_DEV_ALREADY_RUNNING");
  assert.equal(locked.json.lock.pid, holder.pid);
  assert.equal(mockApps().length, 1);
  assert.equal(existsSync(qaReceiptPath(lockIssue)), false);

  // An issue app with no receipt is someone else's; up refuses to stack another on it, and the
  // recovery command carries the host, CLI, and database this run used.
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
  assert.match(
    stray.json.next,
    /down --issue \d+ --host packaged --cli \S*mock-realtimex-pp-cli\.mjs --db /,
  );

  // Another live up or down for the issue holds its lock; up refuses and leaves the lock alone.
  // Fields in the holder's record cannot overwrite the path and reason this run reports.
  resetMockState();
  const busyIssue = nextIssue();
  writeFileSync(
    lockPath(busyIssue),
    JSON.stringify({ pid: process.pid, action: "up", path: "/elsewhere", reason: "contended" }),
  );
  const busy = await run(["up", ...common(busyIssue), "--worktree", worktree]);
  assert.equal(busy.json.errorCode, "QA_LOCKED");
  assert.equal(busy.json.lock.pid, process.pid);
  assert.equal(busy.json.lock.reason, "held");
  assert.equal(busy.json.lock.path, lockPath(busyIssue));
  assert.equal(existsSync(lockPath(busyIssue)), true);
  assert.equal(mockApps().length, 1);
  rmSync(lockPath(busyIssue), { force: true });

  // Happy path. A stale lock from a dead run is taken over, and the dead holder's Next lock left
  // above does not block. The fake app keeps listening until cleanup stops it.
  resetMockState();
  const issue = nextIssue();
  writeFileSync(lockPath(issue), JSON.stringify({ pid: await deadPid(), action: "up" }));
  const app = await fakeApp();
  const first = await run(
    ["up", ...common(issue), "--worktree", worktree, "--loop-id", "loop-test"],
    { MOCK_PORT: String(app.port) },
  );
  assert.equal(first.status, 0, detail(first));
  assert.equal(first.json.reused, false);
  assert.equal(first.json.host, "packaged");
  assert.equal(first.json.port, app.port);
  assert.equal(first.json.portSource, "realtimex");
  assert.equal(first.json.dashboardUrl, `http://127.0.0.1:${app.port}/dashboard`);
  assert.equal(first.json.dataDir, defaultQaDataDir(issue));
  assert.match(
    first.json.next,
    /down --issue \d+ --host packaged --cli \S*mock-realtimex-pp-cli\.mjs --db /,
  );
  assert.equal(existsSync(lockPath(issue)), false);
  const receipt = JSON.parse(readFileSync(qaReceiptPath(issue), "utf8"));
  assert.equal(receipt.baseUrl, "http://127.0.0.1:3001/cli");
  const session = JSON.parse(readFileSync(sessionPath(issue), "utf8"));
  assert.equal(session.canonicalRows[0].id, CANONICAL_SIGNALS_APP_ID);
  assert.equal(session.port, app.port);
  assert.equal(session.cli, mockCli);
  assert.equal(session.dbPath, dbPath);

  // A new app has no decisions yet, so everything the manifest requests is pending.
  assert.deepEqual(first.json.permissions, {
    granted: [],
    denied: [],
    pending: requested,
    lastPromptedAt: null,
  });

  // --needs only names permissions this build requests.
  const bogus = await run([
    "up",
    ...common(issue),
    "--worktree",
    worktree,
    "--needs",
    "llm.chat,bogus.permission",
  ]);
  assert.equal(bogus.status, 2);
  assert.equal(bogus.json.errorCode, "USAGE");
  assert.match(bogus.json.error, /bogus\.permission/);

  // Without a manifest there is nothing to check --needs against, so it is refused, not waited on.
  const manifestPath = join(worktree, "rtx-manifest.json");
  const manifestText = readFileSync(manifestPath, "utf8");
  rmSync(manifestPath);
  const noManifest = await run(["up", ...common(issue), "--worktree", worktree, "--needs", "llm.chat"]);
  writeFileSync(manifestPath, manifestText);
  assert.equal(noManifest.status, 2);
  assert.equal(noManifest.json.errorCode, "USAGE");
  assert.match(noManifest.json.error, /lists no permissions/);

  // Nobody answers the dialog: up names what is missing, keeps the app for the user to grant
  // against, and gives the rerun command.
  const unanswered = await run(
    ["up", ...common(issue), "--worktree", worktree, "--needs", "desktop.runtime-sessions,llm.chat"],
    { MOCK_PORT: String(app.port), SIGNALS_QA_PERMISSION_WAIT_MS: "300" },
  );
  assert.equal(unanswered.status, 1);
  assert.equal(unanswered.json.errorCode, "PERMISSIONS_MISSING");
  assert.deepEqual(unanswered.json.missing, ["desktop.runtime-sessions", "llm.chat"]);
  assert.deepEqual(unanswered.json.denied, []);
  assert.match(unanswered.json.next, /Settings → Local Apps/);
  assert.match(
    unanswered.json.next,
    /up --issue \d+ --host packaged --cli \S+ --db \S+ --needs desktop\.runtime-sessions,llm\.chat --worktree \S+$/,
  );
  assert.equal(mockApps().filter((candidate) => candidate.id !== CANONICAL_SIGNALS_APP_ID).length, 1);

  // The user grants while up waits, and up returns as soon as the needs are met.
  const [grantedUp] = await Promise.all([
    run(["up", ...common(issue), "--worktree", worktree, "--needs", "llm.chat"], {
      MOCK_PORT: String(app.port),
      SIGNALS_QA_PERMISSION_WAIT_MS: "8000",
    }),
    decidePermissions(
      issue,
      { granted: ["llm.chat", "llm.embed"], denied: ["desktop.browser"] },
      { afterMs: 600 },
    ),
  ]);
  assert.equal(grantedUp.status, 0, detail(grantedUp));
  assert.equal(grantedUp.json.reused, true);
  assert.deepEqual(grantedUp.json.permissions.granted, ["llm.chat", "llm.embed"]);
  assert.deepEqual(grantedUp.json.permissions.denied, ["desktop.browser"]);
  assert.equal(grantedUp.json.permissions.pending.includes("llm.chat"), false);

  // A needed permission the user denied fails at once instead of waiting out the dialog.
  const deniedStart = Date.now();
  const deniedUp = await run(
    ["up", ...common(issue), "--worktree", worktree, "--needs", "desktop.browser"],
    { MOCK_PORT: String(app.port), SIGNALS_QA_PERMISSION_WAIT_MS: "20000" },
  );
  assert.equal(deniedUp.json.errorCode, "PERMISSIONS_MISSING");
  assert.deepEqual(deniedUp.json.denied, ["desktop.browser"]);
  assert.deepEqual(deniedUp.json.missing, []);
  assert.match(deniedUp.json.error, /was denied desktop\.browser by the user/);
  assert.doesNotMatch(deniedUp.json.error, /has not been granted/);
  assert.ok(Date.now() - deniedStart < 10_000, "a denied permission must not wait out the dialog");

  // A database that cannot be read is reported as such at once, never as a missing grant after
  // the full wait.
  const missingDbStart = Date.now();
  const missingDb = await run(
    ["up", ...common(issue), "--worktree", worktree, "--needs", "llm.chat", "--db", join(root, "absent.db")],
    { MOCK_PORT: String(app.port) },
  );
  assert.equal(missingDb.json.errorCode, "DB_NOT_FOUND");
  assert.ok(Date.now() - missingDbStart < 10_000, "a missing database must not wait out the dialog");
  const garbageDb = join(root, "garbage.db");
  writeFileSync(garbageDb, "not a database at all, just text long enough to fill a header page\n".repeat(20));
  const unreadable = await run(["status", "--issue", issue, "--db", garbageDb]);
  assert.equal(unreadable.json.errorCode, "DB_UNREADABLE");
  const otherHostDb = join(root, "other-host.db");
  execFileSync("sqlite3", [otherHostDb, "create table local_apps (id text primary key, metadata text);"]);
  const wrongHost = await run(["status", "--issue", issue, "--db", otherHostDb]);
  assert.equal(wrongHost.json.errorCode, "APP_NOT_IN_DB");
  assert.match(wrongHost.json.next, /--db/);

  const again = await run(["up", ...common(issue), "--worktree", worktree], {
    MOCK_PORT: String(app.port),
  });
  assert.equal(again.status, 0, detail(again));
  assert.equal(again.json.reused, true);
  assert.equal(mockApps().filter((candidate) => candidate.id !== CANONICAL_SIGNALS_APP_ID).length, 1);

  const elsewhere = await run(["up", ...common(issue), "--worktree", worktree, "--host", "dev"]);
  assert.equal(elsewhere.json.errorCode, "QA_APP_EXISTS");

  // Reuse refuses an app that lost a safety tag, the same guard cleanup enforces.
  editQaApp(issue, (qaApp) => (qaApp.tags = qaApp.tags.filter((tag) => tag !== "ephemeral")));
  const unsafe = await run(["up", ...common(issue), "--worktree", worktree]);
  assert.equal(unsafe.json.errorCode, "QA_APP_UNSAFE");
  editQaApp(issue, (qaApp) => qaApp.tags.push("ephemeral"));

  // Reuse refuses to recapture the canonical baseline when the session from up is gone.
  const savedSession = readFileSync(sessionPath(issue), "utf8");
  rmSync(sessionPath(issue));
  const lostSession = await run(["up", ...common(issue), "--worktree", worktree]);
  assert.equal(lostSession.json.errorCode, "QA_SESSION_MISSING");
  assert.match(lostSession.json.next, /down --issue \d+ --host packaged --cli /);
  assert.equal(existsSync(sessionPath(issue)), false);
  writeFileSync(sessionPath(issue), savedSession);

  // status and down reuse the CLI up recorded; without it they would hit the tripwire.
  const statusOut = await run(["status", "--issue", issue]);
  assert.equal(statusOut.status, 0, detail(statusOut));
  assert.equal(statusOut.json.present, true);
  assert.equal(statusOut.json.healthy, true);
  assert.equal(statusOut.json.port, app.port);
  assert.deepEqual(statusOut.json.permissions.granted, ["llm.chat", "llm.embed"]);

  const downOut = await run(["down", "--issue", issue], { MOCK_APP_PID: String(app.pid) });
  assert.equal(downOut.status, 0, detail(downOut));
  assert.equal(downOut.json.hygiene, "pass");
  assert.equal(downOut.json.canonicalUnchanged, true);
  assert.equal(downOut.json.portReleased, true);
  assert.equal(downOut.json.appDeleted, true);
  assert.equal(existsSync(qaReceiptPath(issue)), false);
  assert.equal(existsSync(sessionPath(issue)), false);
  assert.equal(existsSync(lockPath(issue)), false);
  assert.equal(mockApps().length, 1);

  // A port that still answers after cleanup fails down. The session stays, so rerunning down once
  // the listener is gone completes the teardown. The rerun command keeps --keep-data, so following
  // it cannot delete the data the first down preserved.
  resetMockState();
  const boundIssue = nextIssue();
  const stubborn = await fakeApp();
  const boundUp = await run(["up", ...common(boundIssue), "--worktree", worktree], {
    MOCK_PORT: String(stubborn.port),
  });
  assert.equal(boundUp.status, 0, detail(boundUp));
  const keptFile = join(defaultQaDataDir(boundIssue), "evidence.txt");
  mkdirSync(defaultQaDataDir(boundIssue), { recursive: true });
  writeFileSync(keptFile, "qa evidence\n");
  const bound = await run(["down", ...common(boundIssue), "--keep-data"], {
    SIGNALS_QA_PORT_RELEASE_MS: "400",
  });
  assert.equal(bound.status, 1);
  assert.equal(bound.json.errorCode, "PORT_STILL_BOUND");
  assert.equal(bound.json.portReleased, false);
  assert.match(bound.json.next, /rerun: .*down --issue \d+ --host packaged --cli .* --keep-data$/);
  assert.equal(existsSync(sessionPath(boundIssue)), true);
  await stopChild(stubborn.child);
  const boundRerun = await run(["down", ...common(boundIssue), "--keep-data"]);
  assert.equal(boundRerun.status, 0, detail(boundRerun));
  assert.equal(boundRerun.json.portReleased, true);
  assert.equal(boundRerun.json.appDeleted, false);
  assert.equal(existsSync(sessionPath(boundIssue)), false);
  assert.equal(existsSync(keptFile), true);

  // A canonical record that changes while QA runs fails down and says not to restore it here.
  resetMockState();
  const changedIssue = nextIssue();
  const changedApp = await fakeApp();
  const changedUp = await run(["up", ...common(changedIssue), "--worktree", worktree], {
    MOCK_PORT: String(changedApp.port),
  });
  assert.equal(changedUp.status, 0, detail(changedUp));
  writeCanonicalRow(canonicalConfig({ env: { ...canonicalConfig().env, PORT: "3999" } }));
  const changedDown = await run(["down", ...common(changedIssue)], {
    MOCK_APP_PID: String(changedApp.pid),
  });
  assert.equal(changedDown.status, 1);
  assert.equal(changedDown.json.errorCode, "CANONICAL_CHANGED");
  assert.deepEqual(changedDown.json.changedFields, ["config.env.PORT"]);
  assert.match(changedDown.json.next, /Do not run --restore-canonical/);
  assert.equal(existsSync(sessionPath(changedIssue)), true);
  writeCanonicalRow(canonicalConfig());
  rmSync(sessionPath(changedIssue), { force: true });

  // RTX_DB_PATH selects the database when --db is absent, and down uses the one up recorded.
  resetMockState();
  const envDbIssue = nextIssue();
  const envDbApp = await fakeApp();
  const envDbUp = await run(["up", "--issue", envDbIssue, "--cli", mockCli, "--worktree", worktree], {
    MOCK_PORT: String(envDbApp.port),
    RTX_DB_PATH: dbPath,
  });
  assert.equal(envDbUp.status, 0, detail(envDbUp));
  assert.equal(JSON.parse(readFileSync(sessionPath(envDbIssue), "utf8")).dbPath, dbPath);
  const envDbDown = await run(["down", "--issue", envDbIssue], {
    MOCK_APP_PID: String(envDbApp.pid),
  });
  assert.equal(envDbDown.status, 0, detail(envDbDown));
  assert.equal(envDbDown.json.canonicalUnchanged, true);

  // On a new app, up waits through provisioning for the user's decision too.
  resetMockState();
  const freshNeedsIssue = nextIssue();
  const freshNeedsApp = await fakeApp();
  const [freshNeeds] = await Promise.all([
    run(["up", ...common(freshNeedsIssue), "--worktree", worktree, "--needs", "llm.embed"], {
      MOCK_PORT: String(freshNeedsApp.port),
      SIGNALS_QA_PERMISSION_WAIT_MS: "8000",
    }),
    decidePermissions(freshNeedsIssue, { granted: ["llm.embed"], denied: [] }, { afterMs: 300 }),
  ]);
  assert.equal(freshNeeds.status, 0, detail(freshNeeds));
  assert.equal(freshNeeds.json.reused, false);
  assert.deepEqual(freshNeeds.json.permissions.granted, ["llm.embed"]);
  const freshNeedsDown = await run(["down", ...common(freshNeedsIssue)], {
    MOCK_APP_PID: String(freshNeedsApp.pid),
  });
  assert.equal(freshNeedsDown.status, 0, detail(freshNeedsDown));

  // A dev-host rerun without --cli uses the CLI up recorded; the default CLI (the tripwire here)
  // cannot authenticate there.
  resetMockState();
  const devIssue = nextIssue();
  const devApp = await fakeApp();
  const devUp = await run(["up", ...common(devIssue), "--host", "dev", "--worktree", worktree], {
    MOCK_PORT: String(devApp.port),
  });
  assert.equal(devUp.status, 0, detail(devUp));
  assert.equal(devUp.json.host, "dev");
  assert.match(devUp.json.next, /down --issue \d+ --host dev --cli /);
  const devAgain = await run(
    ["up", "--issue", devIssue, "--host", "dev", "--db", dbPath, "--worktree", worktree],
    { MOCK_PORT: String(devApp.port) },
  );
  assert.equal(devAgain.status, 0, detail(devAgain));
  assert.equal(devAgain.json.reused, true);
  const devDown = await run(["down", "--issue", devIssue], { MOCK_APP_PID: String(devApp.pid) });
  assert.equal(devDown.status, 0, detail(devDown));
  assert.equal(devDown.json.host, "dev");

  // A down on the dev host with neither receipt nor session keeps --host dev in its rerun command.
  resetMockState();
  const orphanIssue = nextIssue();
  execFileSync("sqlite3", [
    dbPath,
    "insert into local_apps (id, display_name, name, config, tags, status) values " +
      `('orphan-qa-row', 'Signals issue-${orphanIssue} QA', 'orphan', '{}', NULL, 'stopped');`,
  ]);
  const orphanDown = await run(["down", ...common(orphanIssue), "--host", "dev"]);
  execFileSync("sqlite3", [dbPath, "delete from local_apps where id = 'orphan-qa-row';"]);
  assert.equal(orphanDown.json.errorCode, "HYGIENE_FAILED");
  assert.match(orphanDown.json.next, /rerun: .*down --issue \d+ --host dev /);

  // A reused app that fails to start reports its logs and the teardown command.
  resetMockState();
  const reuseIssue = nextIssue();
  const reuseApp = await fakeApp();
  const reuseUp = await run(["up", ...common(reuseIssue), "--worktree", worktree], {
    MOCK_PORT: String(reuseApp.port),
  });
  assert.equal(reuseUp.status, 0, detail(reuseUp));
  editQaApp(reuseIssue, (qaApp) => {
    qaApp.persistedStatus = "stopped";
    qaApp.runtime = { status: "stopped" };
  });
  const reuseCrash = await run(["up", ...common(reuseIssue), "--worktree", worktree], {
    MOCK_PORT: String(reuseApp.port),
    MOCK_STATUS: "crashed",
  });
  assert.equal(reuseCrash.json.errorCode, "START_FAILED");
  assert.deepEqual(reuseCrash.json.logs, ["err boom: port in use"]);
  assert.match(reuseCrash.json.next, /down --issue/);
  const reuseDown = await run(["down", ...common(reuseIssue)], {
    MOCK_APP_PID: String(reuseApp.pid),
  });
  assert.equal(reuseDown.status, 0, detail(reuseDown));

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
  assert.equal((await run(["down", ...common(silentIssue)])).status, 0);

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
  const devServer = await fakeApp();
  const viaLock = await run(["up", ...common(lockPortIssue), "--worktree", worktree], {
    MOCK_PORT: String(devServer.port),
    MOCK_NO_PORT: "1",
    MOCK_LOCK_PID: String(devServer.pid),
  });
  assert.equal(viaLock.status, 0, detail(viaLock));
  assert.equal(viaLock.json.port, devServer.port);
  assert.equal(viaLock.json.portSource, "next-lock");
  const viaLockStatus = await run(["status", ...common(lockPortIssue)]);
  assert.equal(viaLockStatus.json.healthy, true);
  assert.equal(viaLockStatus.json.portSource, "next-lock");
  const viaLockDown = await run(["down", ...common(lockPortIssue)], {
    MOCK_APP_PID: String(devServer.pid),
  });
  assert.equal(viaLockDown.status, 0, detail(viaLockDown));
  assert.equal(viaLockDown.json.port, devServer.port);
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

  assert.deepEqual(failuresWithoutNext, [], "every failure must carry a next");
  assert.match(unreadable.json.next, /--db/);

  console.log("qa-local-app orchestrator: OK");
} finally {
  await Promise.all([...children].map((child) => stopChild(child)));
  for (const issue of issues) {
    rmSync(qaReceiptPath(issue), { force: true });
    rmSync(sessionPath(issue), { force: true });
    rmSync(lockPath(issue), { force: true });
    rmSync(defaultQaDataDir(issue), { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}
