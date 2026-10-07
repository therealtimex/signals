#!/usr/bin/env node
/**
 * Tests for qa-local-app.mjs and migrate-dev-signals-row.mjs against a mock realtimex-pp-cli,
 * fixture Dev and installed-app databases, a fixture "real" Signals data dir, and fake Dev apps:
 * processes the mock starts on each app's pinned port, serving /api/health from the app's env the
 * way Signals would. Nothing here reaches a RealTimeX host or the real ~/.signals. Every run sets
 * REALTIMEX_PP_CLI to a tripwire, so a command that falls back to the default CLI fails instead of
 * talking to a live host.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
  isCanonicalSignalsDataDir,
  qaTemporaryRoot,
} from "./signals-qa-local-app.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const orchestrator = join(scriptDir, "qa-local-app.mjs");
const migrator = join(scriptDir, "migrate-dev-signals-row.mjs");

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

// The launcher reads RealTimeX databases with the sqlite3 CLI, so without it the lifecycle cannot
// run at all. Skip it the way test-signals-qa-local-app.mjs skips its sqlite section.
if (spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status !== 0) {
  console.log("qa-local-app orchestrator: SKIP lifecycle tests (sqlite3 CLI not found)");
  process.exit(0);
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "signals-dev-orchestrator-test-")));
const repo = join(root, "repo");
const worktreesDir = join(root, "worktrees");
const devRoot = join(root, "signals-dev");
const realData = join(root, "real-signals");
const devDb = join(root, "dev", "realtimex.db");
const packagedDb = join(root, "app", "realtimex.db");
const statePath = join(root, "local-apps.json");
const pidLog = join(root, "pids.log");
const credLog = join(root, "credentials-sent.log");
const registerLog = join(root, "registrations.log");
const mockCli = join(root, "mock-realtimex-pp-cli.mjs");
const tripwireCli = join(root, "tripwire-realtimex-pp-cli.mjs");
const legacyTag = String(Date.now()).slice(-7);
// Pre-#541 QA data lived in the platform temp root (/private/tmp on macOS, /tmp on Linux CI).
const legacyQaData = join(qaTemporaryRoot(), `signals-qa-issue-9${legacyTag}-data`);
const children = new Set();
// The launcher promises a `next` on every failure; any run that breaks that lands here.
const failuresWithoutNext = [];
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;
// What the fixture checkout's rtx-manifest.json requests, as Signals' does.
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

function killLoggedPids() {
  if (!existsSync(pidLog)) return;
  for (const pid of readFileSync(pidLog, "utf8").split("\n").filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function listen(port) {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer((request, response) => response.end("busy"));
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

const devSql = (statement) => execFileSync("sqlite3", [devDb, statement], { encoding: "utf8" }).trim();
const packagedSql = (statement) => execFileSync("sqlite3", [packagedDb, statement], { encoding: "utf8" }).trim();
const mockState = () => JSON.parse(readFileSync(statePath, "utf8"));
const writeMockState = (state) => writeFileSync(statePath, JSON.stringify(state));
const devRow = (id) => JSON.parse(execFileSync("sqlite3", ["-json", devDb, `select * from local_apps where id = ${sql(id)};`], { encoding: "utf8" }) || "[]")[0];
const receiptFor = (slot) => JSON.parse(readFileSync(join(devRoot, slot, ".launcher", "receipt.json"), "utf8"));
const sessionPath = (slot) => join(devRoot, slot, ".launcher", "session.json");
const lockPath = (slot) => join(devRoot, ".locks", `${slot}.lock`);

function addMockApp(app, row) {
  const state = mockState();
  state.apps.push(app);
  writeMockState(state);
  devSql(
    "insert into local_apps (id, display_name, name, config, tags, status, metadata) values (" +
      [app.id, app.displayName, row.name ?? app.id, JSON.stringify(row.config ?? {}), JSON.stringify(app.tags ?? []), "stopped", "{}"]
        .map(sql)
        .join(", ") +
      ");",
  );
}

function dropMockApp(id) {
  const state = mockState();
  state.apps = state.apps.filter((app) => app.id !== id);
  writeMockState(state);
  devSql(`delete from local_apps where id = ${sql(id)};`);
}

// Stands in for the owner answering RealTimeX's dialog: RealTimeX records the decision on the row.
async function decidePermissions(appId, decision, { afterMs = 0 } = {}) {
  await sleep(afterMs);
  devSql(`update local_apps set metadata = ${sql(JSON.stringify({ permissions: decision }))} where id = ${sql(appId)};`);
}

// What each Dev app asked RealTimeX for when it booted, oldest first.
const registrations = (slot) =>
  existsSync(registerLog)
    ? readFileSync(registerLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.dataDir === join(devRoot, slot))
    : [];
const needsFile = (slot) => JSON.parse(readFileSync(join(devRoot, slot, ".launcher", "needs.json"), "utf8"));

// The owner answering the dialog a slot's next registration opens. Fails the test if no such
// registration arrives, so a missing restart cannot pass as an owner who never answered.
async function ownerAnswers(slot, decision, { after = registrations(slot).length, timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (registrations(slot).length <= after) {
    if (Date.now() > deadline) throw new Error(`${slot} did not register again within ${timeoutMs} ms`);
    await sleep(50);
  }
  const entry = registrations(slot)[after];
  await decidePermissions(entry.appId, decision);
  return entry;
}

function run(script, args, env = {}) {
  return new Promise((resolveRun) => {
    const child = track(
      spawn(process.execPath, [script, ...args], {
        env: {
          ...process.env,
          MOCK_LOCAL_APPS_STATE: statePath,
          MOCK_DEV_DB: devDb,
          MOCK_PID_LOG: pidLog,
          MOCK_CRED_LOG: credLog,
          MOCK_REGISTER_LOG: registerLog,
          REALTIMEX_PP_CLI: tripwireCli,
          SIGNALS_DEV_ROOT: devRoot,
          SIGNALS_CANONICAL_DATA_DIR: realData,
          SIGNALS_QA_POLL_MS: "50",
          SIGNALS_QA_PORT_RELEASE_MS: "5000",
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

const qa = (args, env) => run(orchestrator, args, env);
const host = ["--cli", mockCli, "--db", devDb, "--packaged-db", packagedDb];
const detail = (result) => `${result.stdout}${result.stderr}`;

function addWorktree(name, branch) {
  const path = join(worktreesDir, name);
  execFileSync("git", ["worktree", "add", "-b", branch, path], { cwd: repo, stdio: "ignore" });
  return path;
}

try {
  // ---- Fixtures --------------------------------------------------------------------------------
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "qa-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Signals QA Test"], { cwd: repo });
  writeFileSync(join(repo, "package.json"), '{ "name": "@realtimex/signals", "private": true }\n');
  writeFileSync(join(repo, "rtx-manifest.json"), `${JSON.stringify({ permissions: requested })}\n`);
  execFileSync("git", ["add", "package.json", "rtx-manifest.json"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo, stdio: "ignore" });
  const wtA = addWorktree("loop-issue-77-aaaa", "issue-77");
  const wtB = addWorktree("loop-issue-78-bbbb", "issue-78");

  mkdirSync(dirname(devDb), { recursive: true });
  mkdirSync(dirname(packagedDb), { recursive: true });
  const appsTable =
    "create table local_apps (id text primary key, display_name text, name text, config text, tags text, status text, metadata text);" +
    "create table workspaces (id integer primary key, slug text);";
  execFileSync("sqlite3", [devDb, appsTable]);
  execFileSync("sqlite3", [packagedDb, appsTable]);
  const canonicalConfig = (version = "0.2.20", env = {}) =>
    JSON.stringify({
      command: "/node/bin/node",
      args: ["server.js"],
      working_dir: join(root, "app", "marketplace-deploy", `signals-${version}`),
      env: { SIGNALS_DATA_DIR: join(homedir(), ".signals"), PORT: "3010", ...env },
    });
  packagedSql(
    `insert into local_apps (id, display_name, name, config, tags, status) values (${sql(CANONICAL_SIGNALS_APP_ID)}, 'Signals', 'signals', ${sql(canonicalConfig())}, '[]', 'running');` +
      "insert into workspaces (slug) values ('signals');",
  );

  // The owner's "real" Signals data, for the snapshot profile.
  mkdirSync(join(realData, "media"), { recursive: true });
  mkdirSync(join(realData, "browser-profiles"), { recursive: true });
  writeFileSync(join(realData, "media", "avatar.png"), "png");
  writeFileSync(join(realData, "browser-profiles", "cookies"), "signed-in");
  writeFileSync(join(realData, "config.json"), '{"mail":"owner"}');
  execFileSync("sqlite3", [
    join(realData, "data.db"),
    "create table platform_accounts (id integer primary key, credentials_encrypted text, status text);" +
      "insert into platform_accounts values (1, 'cipher', 'active');" +
      "create table scheduled_jobs (id integer primary key, status text, run_at text);" +
      "insert into scheduled_jobs values (1, 'pending', '2000-01-01');",
  ]);

  writeFileSync(tripwireCli, '#!/usr/bin/env node\nconsole.error("tripwire: a command fell back to the default realtimex-pp-cli");\nprocess.exit(97);\n');
  chmodSync(tripwireCli, 0o755);
  writeMockState({ apps: [] });

  // The mock keeps the CLI's view in a JSON state file and RealTimeX's rows in the Dev database,
  // and "runs" an app by starting a process on its pinned port that answers /api/health from the
  // app's env, as Signals does.
  writeFileSync(
    mockCli,
    `#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.MOCK_LOCAL_APPS_STATE;
const sqlite = (statement) => execFileSync("sqlite3", [process.env.MOCK_DEV_DB, statement]);
const quote = (text) => "'" + String(text).replace(/'/g, "''") + "'";
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const command = args[0];
const value = (flag) => args[args.indexOf(flag) + 1];
const save = () => writeFileSync(statePath, JSON.stringify(state));
const find = (id) => state.apps.find((app) => app.id === id);
const kill = (app) => {
  if (!app?.pid) return;
  try { process.kill(app.pid, "SIGTERM"); } catch {}
  app.pid = null;
};
if (process.env.MOCK_CRED_LOG && (process.env.REALTIMEX_TERMINAL_SESSION_TOKEN || process.env.REALTIMEX_APP_ID_AUTH || process.env.REALTIMEX_CONFIG)) {
  appendFileSync(process.env.MOCK_CRED_LOG, command + "\\n");
}
if (process.env.MOCK_REFUSE === "1") {
  console.error('Error: GET /' + command + ' returned HTTP 403: {"error":"Scoped credential is not allowed for this route."}');
  process.exit(4);
}
if (process.env.MOCK_UNREACHABLE === "1") {
  console.error("Error: Get http://127.0.0.1:3101/cli/" + command + ": dial tcp 127.0.0.1:3101: connect: connection refused");
  process.exit(5);
}
let results;
if (command === "list-local-apps") {
  results = { apps: state.apps.map(({ env, pid, ...app }) => app) };
} else if (command === "create-local-app") {
  const env = JSON.parse(value("--env"));
  const app = {
    id: "dev-app-" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
    displayName: value("--display-name"),
    tags: value("--tags").split(","),
    env,
    persistedStatus: "stopped",
    runtime: { status: "stopped" },
  };
  state.apps.push(app);
  save();
  const config = { command: "/node/bin/npm", args: ["start"], working_dir: "/storage/local-apps/" + app.id, env, home_url: value("--home-url") };
  sqlite("insert into local_apps (id, display_name, name, config, tags, status, metadata) values (" + [app.id, app.displayName, "signals-dev", JSON.stringify(config), JSON.stringify(app.tags), "stopped", "{}"].map(quote).join(", ") + ");");
  results = { app: { id: app.id, displayName: app.displayName, tags: app.tags } };
} else if (command === "start-local-app") {
  const app = find(args[1]);
  const startTime = Date.now();
  const status = process.env.MOCK_STATUS || "running";
  const port = Number(process.env.MOCK_BIND_PORT || app.env.PORT);
  if (status === "running" && process.env.MOCK_NO_SPAWN !== "1") {
    const health = process.env.MOCK_HEALTH || "guarded";
    const child = spawn(process.execPath, ["-e", \`
      const env = process.env;
      const dev = env.SIGNALS_INSTANCE === "dev";
      const body = { app: "signals", rtx: { mode: "embedded", appId: null, registered: false } };
      // Registers at boot the way Signals does (#545): a Dev app asks for its slot's needs.json.
      // RealTimeX's /sdk/register then prompts only for what the row has not decided yet.
      if (dev && env.MOCK_REGISTER_LOG) {
        const fs = require("node:fs");
        let needs = null;
        try { needs = JSON.parse(fs.readFileSync(env.SIGNALS_DATA_DIR + "/.launcher/needs.json", "utf8")).needs; } catch {}
        const registered = Array.isArray(needs) ? needs : [];
        let decided = {};
        try {
          const row = require("node:child_process").execFileSync("sqlite3", [env.MOCK_DEV_DB, "select metadata from local_apps where id = '" + env.MOCK_APP_ID + "';"], { encoding: "utf8" });
          decided = JSON.parse(row || "{}").permissions || {};
        } catch {}
        const known = [].concat(decided.granted || [], decided.denied || []);
        const prompted = registered.filter((permission) => !known.includes(permission));
        fs.appendFileSync(env.MOCK_REGISTER_LOG, JSON.stringify({ appId: env.MOCK_APP_ID, dataDir: env.SIGNALS_DATA_DIR, registered, prompted }) + String.fromCharCode(10));
      }
      if (env.MOCK_HEALTH !== "unguarded") {
        body.instance = {
          kind: dev ? "dev" : "canonical",
          externalEffects: dev ? "denied" : "allowed",
          scheduler: env.SIGNALS_SCHEDULER_ENABLED === "0" ? "disabled" : "enabled",
          dataDir: env.SIGNALS_DATA_DIR,
        };
      }
      require("node:http").createServer((request, response) => {
        response.writeHead(request.url === "/api/health" ? 200 : 404, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      }).listen(Number(env.MOCK_LISTEN_PORT), "127.0.0.1");
    \`, "next-server-fake-dev-app"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...app.env, MOCK_APP_ID: app.id, MOCK_HEALTH: health, MOCK_LISTEN_PORT: String(port) },
    });
    child.unref();
    app.pid = child.pid;
    appendFileSync(process.env.MOCK_PID_LOG, child.pid + "\\n");
  }
  app.persistedStatus = status === "running" ? "running" : "stopped";
  app.runtime = { status, runningPort: status === "running" ? port : null, startTime };
  save();
  results = { success: true, appId: args[1] };
} else if (command === "get-local-app-status") {
  results = { success: true, appId: args[1], runtime: find(args[1])?.runtime ?? null };
} else if (command === "get-local-app-logs") {
  results = { success: true, logs: [{ type: "stderr", content: "\\u001b[31mboom: port in use\\u001b[39m", timestamp: 1 }] };
} else if (command === "stop-local-app") {
  const app = find(args[1]);
  kill(app);
  app.persistedStatus = "stopped";
  app.runtime = { status: "stopped" };
  save();
  results = { success: true, appId: args[1] };
} else if (command === "delete-local-app") {
  kill(find(args[1]));
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

  // ---- Usage and refusals; nothing is created ----------------------------------------------------
  assert.equal((await qa(["--help"])).status, 0);
  const unknown = await qa(["launch"]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.json.errorCode, "USAGE");
  assert.equal((await qa(["up", "--worktree", wtA, ...host, "--host", "packaged"])).json.errorCode, "HOST_PACKAGED_FORBIDDEN");
  assert.equal(
    (await qa(["up", "--worktree", wtA, "--cli", mockCli, "--db", packagedDb, "--packaged-db", packagedDb])).json.errorCode,
    "HOST_PACKAGED_FORBIDDEN",
  );
  const refused = await qa(["up", "--worktree", wtA, ...host], { MOCK_REFUSE: "1" });
  assert.equal(refused.json.errorCode, "LOCAL_APP_MANAGEMENT_REFUSED");
  assert.match(refused.json.next, /never-expiring scoped CLI key/);
  const unreachable = await qa(["up", "--worktree", wtA, ...host], { MOCK_UNREACHABLE: "1" });
  assert.equal(unreachable.json.errorCode, "HOST_UNREACHABLE");
  assert.match(unreachable.json.next, /never starts it/);
  const foreign = join(root, "foreign");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "package.json"), '{ "name": "other" }\n');
  assert.equal((await qa(["up", "--worktree", foreign, ...host])).json.errorCode, "WORKTREE_INVALID");
  assert.equal(mockState().apps.length, 0);
  assert.equal(existsSync(devRoot), false);

  // The legacy Dev "Signals" row (real data, port 3010) blocks every up until slice 1 removes it.
  const legacyConfig = { command: "/node/bin/npm", args: ["run", "dev"], working_dir: repo, port: 3010, home_url: "http://localhost:3010/dashboard", env: { SIGNALS_DATA_DIR: "~/.signals", PORT: "3010" } };
  addMockApp({ id: CANONICAL_SIGNALS_APP_ID, displayName: "Signals", tags: [], persistedStatus: "stopped" }, { name: "signals", config: legacyConfig });
  const unsafe = await qa(["up", "--worktree", wtA, ...host]);
  assert.equal(unsafe.json.errorCode, "DEV_HOST_UNSAFE");
  assert.equal(unsafe.json.problems.length, 2);
  assert.match(unsafe.json.next, /migrate-dev-signals-row\.mjs/);
  dropMockApp(CANONICAL_SIGNALS_APP_ID);

  // A live `next dev` lock in the checkout blocks a new app.
  const holder = track(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "next-server-lock-holder"]));
  mkdirSync(join(wtA, ".next", "dev"), { recursive: true });
  writeFileSync(join(wtA, ".next", "dev", "lock"), JSON.stringify({ pid: holder.pid, port: 4999, appUrl: "http://localhost:4999" }));
  const locked = await qa(["up", "--worktree", wtA, ...host]);
  await stopChild(holder);
  rmSync(join(wtA, ".next"), { recursive: true, force: true });
  assert.equal(locked.json.errorCode, "NEXT_DEV_ALREADY_RUNNING");
  assert.equal(mockState().apps.length, 0);

  // Another live run holds the slot; its record cannot overwrite the path and reason reported.
  mkdirSync(dirname(lockPath("loop-issue-77-aaaa")), { recursive: true });
  writeFileSync(lockPath("loop-issue-77-aaaa"), JSON.stringify({ pid: process.pid, action: "up", path: "/elsewhere", reason: "contended" }));
  const busy = await qa(["up", "--worktree", wtA, ...host]);
  assert.equal(busy.json.errorCode, "SLOT_LOCKED");
  assert.equal(busy.json.lock.path, lockPath("loop-issue-77-aaaa"));
  assert.equal(busy.json.lock.reason, "held");
  rmSync(lockPath("loop-issue-77-aaaa"));
  assert.equal(mockState().apps.length, 0);

  // ---- Happy path: a linked worktree and the main checkout, side by side ------------------------
  // Run as an installed-app terminal: its credentials must never reach the Dev host.
  const installedTerminal = {
    REALTIMEX_BASE_URL: "http://127.0.0.1:3001/cli",
    REALTIMEX_TERMINAL_SESSION_TOKEN: "installed-session",
    REALTIMEX_APP_ID_AUTH: "installed-app-id",
    REALTIMEX_CONFIG: "/installed/config.toml",
  };
  const first = await qa(["up", "--worktree", wtA, ...host, "--issue", "77", "--loop-id", "loop-issue-77-aaaa"], installedTerminal);
  assert.equal(existsSync(credLog), false, "installed-app credentials reached the Dev host CLI");
  assert.equal(first.status, 0, detail(first));
  const slotA = "loop-issue-77-aaaa";
  assert.equal(first.json.slot, slotA);
  assert.equal(first.json.reused, false);
  assert.equal(first.json.displayName, `Signals Dev · ${slotA}`);
  assert.equal(first.json.dataDir, join(devRoot, slotA));
  assert.equal(first.json.workspaceSlug, `signals-dev-${slotA}`);
  assert.equal(first.json.profile, "empty");
  assert.equal(first.json.timeoutMs, 600000, "a new slot waits out a cold compile");
  assert.ok(first.json.port >= 3300 && first.json.port < 3500, String(first.json.port));
  assert.deepEqual(first.json.instance, { kind: "dev", externalEffects: "denied", scheduler: "disabled", dataDir: join(devRoot, slotA) });
  // Without --needs a new slot asks RealTimeX for nothing, so the owner sees no dialog (#545).
  assert.deepEqual(first.json.permissions, { requested: [], granted: [], denied: [], pending: [], lastPromptedAt: null });
  assert.deepEqual(first.json.needs.recorded, []);
  assert.equal(first.json.restarted, false);
  assert.deepEqual(needsFile("loop-issue-77-aaaa").needs, []);
  assert.deepEqual(
    registrations("loop-issue-77-aaaa").map(({ registered, prompted }) => ({ registered, prompted })),
    [{ registered: [], prompted: [] }],
  );
  assert.equal(first.json.staleSlots.total, 0);
  assert.match(first.json.next, /down --worktree /);
  const appA = first.json.appId;
  const rowA = devRow(appA);
  const configA = JSON.parse(rowA.config);
  assert.equal(configA.env.SIGNALS_INSTANCE, "dev");
  assert.equal(configA.env.SIGNALS_SCHEDULER_ENABLED, "0");
  assert.equal(configA.env.SIGNALS_DATA_DIR, join(devRoot, slotA));
  assert.equal(configA.env.SIGNALS_DEV_WORKTREE, wtA);
  assert.equal(configA.env.SIGNALS_RTX_WORKSPACE_SLUG, `signals-dev-${slotA}`);
  assert.equal(configA.env.PORT, String(first.json.port));
  assert.equal(configA.env.REALTIMEX_BASE_URL, "http://127.0.0.1:3101/cli");
  assert.equal(configA.home_url, `http://localhost:${first.json.port}/dashboard`);
  assert.deepEqual(JSON.parse(rowA.tags).slice(0, 3), ["signals", "dev", `slot-${slotA}`]);
  assert.ok(JSON.parse(rowA.tags).includes("issue-77"));
  const receiptA = receiptFor(slotA);
  assert.equal(receiptA.kind, "signals-dev-local-app");
  assert.equal(receiptA.worktree, wtA);
  assert.equal(receiptA.branch, "issue-77");
  assert.equal(receiptA.appId, appA);
  assert.equal(receiptA.port, first.json.port);
  assert.ok(receiptA.lastUpAt);
  assert.equal(JSON.parse(readFileSync(sessionPath(slotA), "utf8")).packaged.rows[0].id, CANONICAL_SIGNALS_APP_ID);
  assert.equal(JSON.parse(readFileSync(join(devRoot, ".launcher", "host.json"), "utf8")).cli, mockCli);
  assert.equal(existsSync(lockPath(slotA)), false);

  // A new slot with --needs asks for exactly those, and up waits for the owner's answer.
  const [mainUp, mainDialog] = await Promise.all([
    qa(["up", "--worktree", repo, ...host, "--needs", "llm.chat"], { SIGNALS_QA_PERMISSION_WAIT_MS: "20000" }),
    ownerAnswers("main", { granted: ["llm.chat"], denied: [] }),
  ]);
  assert.equal(mainUp.status, 0, detail(mainUp));
  assert.deepEqual(mainDialog.registered, ["llm.chat"]);
  assert.deepEqual(mainDialog.prompted, ["llm.chat"]);
  assert.deepEqual(mainUp.json.needs.recorded, ["llm.chat"]);
  assert.deepEqual(mainUp.json.permissions.pending, []);
  assert.equal(mainUp.json.restarted, false);
  assert.equal(mainUp.json.slot, "main");
  assert.equal(mainUp.json.primary, true);
  assert.notEqual(mainUp.json.port, first.json.port);
  assert.notEqual(mainUp.json.dataDir, first.json.dataDir);
  assert.notEqual(mainUp.json.workspaceSlug, first.json.workspaceSlug);
  for (const worktree of [wtA, repo]) {
    const statusOut = await qa(["status", "--worktree", worktree]);
    assert.equal(statusOut.status, 0, detail(statusOut));
    assert.equal(statusOut.json.healthy, true);
    assert.deepEqual(statusOut.json.instanceProblems, []);
  }

  // Reruns reuse the app; host.json supplies the CLI and databases.
  const again = await qa(["up", "--worktree", wtA]);
  assert.equal(again.status, 0, detail(again));
  assert.equal(again.json.reused, true);
  assert.equal(again.json.appId, appA);
  assert.equal(again.json.port, first.json.port);
  assert.equal(again.json.timeoutMs, 240000);
  assert.equal(again.json.restarted, false);
  assert.equal(registrations(slotA).length, 1, "a rerun without new needs must not restart the app");

  // --needs: only what this build requests; the owner grants while up waits; a denial fails fast.
  const bogus = await qa(["up", "--worktree", wtA, "--needs", "llm.chat,bogus.permission"]);
  assert.equal(bogus.status, 2);
  assert.match(bogus.json.error, /bogus\.permission/);
  assert.deepEqual(needsFile(slotA).needs, [], "a refused --needs must not be recorded");

  // A reused, running slot whose needs grow restarts, so the app registers again (#545).
  const [granted, chatDialog] = await Promise.all([
    qa(["up", "--worktree", wtA, "--needs", "llm.chat"], { SIGNALS_QA_PERMISSION_WAIT_MS: "8000" }),
    ownerAnswers(slotA, { granted: ["llm.chat"], denied: ["desktop.browser"] }),
  ]);
  assert.equal(granted.status, 0, detail(granted));
  assert.equal(granted.json.restarted, true);
  assert.deepEqual(granted.json.needs, { path: join(devRoot, slotA, ".launcher", "needs.json"), recorded: ["llm.chat"], added: ["llm.chat"] });
  assert.deepEqual(chatDialog.prompted, ["llm.chat"]);
  assert.deepEqual(granted.json.permissions.granted, ["llm.chat"]);
  assert.deepEqual(granted.json.permissions.requested, ["llm.chat"]);

  // The same needs again: nothing new, so no restart and no dialog.
  const sameNeeds = await qa(["up", "--worktree", wtA, "--needs", "llm.chat"]);
  assert.equal(sameNeeds.status, 0, detail(sameNeeds));
  assert.equal(sameNeeds.json.restarted, false);
  assert.deepEqual(sameNeeds.json.needs.added, []);
  assert.equal(registrations(slotA).length, 2);

  // Growing to llm.chat,llm.embed restarts and the dialog asks only about llm.embed; llm.chat stays
  // granted.
  const [grown, embedDialog] = await Promise.all([
    qa(["up", "--worktree", wtA, "--needs", "llm.chat,llm.embed"], { SIGNALS_QA_PERMISSION_WAIT_MS: "8000" }),
    ownerAnswers(slotA, { granted: ["llm.chat", "llm.embed"], denied: ["desktop.browser"] }),
  ]);
  assert.equal(grown.status, 0, detail(grown));
  assert.equal(grown.json.restarted, true);
  assert.deepEqual(grown.json.needs.added, ["llm.embed"]);
  assert.deepEqual(embedDialog.registered, ["llm.chat", "llm.embed"]);
  assert.deepEqual(embedDialog.prompted, ["llm.embed"]);
  assert.deepEqual(grown.json.permissions.granted, ["llm.chat", "llm.embed"]);

  // A smaller --needs never narrows the slot: what it asked for before stays recorded.
  const narrower = await qa(["up", "--worktree", wtA, "--needs", "llm.embed"]);
  assert.equal(narrower.status, 0, detail(narrower));
  assert.equal(narrower.json.restarted, false);
  assert.deepEqual(needsFile(slotA).needs, ["llm.chat", "llm.embed"]);

  const deniedStart = Date.now();
  const denied = await qa(["up", "--worktree", wtA, "--needs", "desktop.browser"], { SIGNALS_QA_PERMISSION_WAIT_MS: "20000" });
  assert.equal(denied.json.errorCode, "PERMISSIONS_MISSING");
  assert.deepEqual(denied.json.denied, ["desktop.browser"]);
  assert.match(denied.json.next, /Signals Dev · loop-issue-77-aaaa/);
  assert.ok(Date.now() - deniedStart < 10_000, "a denied permission must not wait out the dialog");
  assert.deepEqual(registrations(slotA).at(-1).prompted, [], "a denied permission is not asked again");

  // down stops the app and keeps the row, data, receipt, and the owner's grants.
  const downA = await qa(["down", "--worktree", wtA]);
  assert.equal(downA.status, 0, detail(downA));
  assert.equal(downA.json.stopped, true);
  assert.equal(downA.json.portReleased, true);
  assert.equal(downA.json.packagedHostUnchanged, true);
  assert.deepEqual(downA.json.devHostProblems, []);
  assert.ok(mockState().apps.some((app) => app.id === appA));
  assert.equal(existsSync(join(devRoot, slotA)), true);
  assert.equal(existsSync(sessionPath(slotA)), false);
  assert.match(downA.json.nextOnLoopClose, /remove --worktree /);
  const regrant = await qa(["up", "--worktree", wtA]);
  assert.equal(regrant.status, 0, detail(regrant));
  assert.equal(regrant.json.reused, true);
  assert.deepEqual(regrant.json.permissions.granted, ["llm.chat", "llm.embed"]);
  assert.deepEqual(regrant.json.permissions.requested, ["llm.embed", "llm.chat", "desktop.browser"], "manifest order, as Signals asks");
  assert.deepEqual(regrant.json.permissions.pending, []);
  assert.equal(regrant.json.restarted, false, "a stopped app registers when it starts; no restart");

  // A grant saved by RealTimeX's Settings screen before realtimex-ai-app#2277 is nested one level
  // deeper. RealTimeX honours it, so status and up must report it as granted, not pending.
  await decidePermissions(appA, {
    granted: { granted: ["llm.chat", "llm.embed"], denied: ["desktop.browser"] },
    grantedAt: "2026-10-06T00:00:00.000Z",
  });
  const nested = await qa(["status", "--worktree", wtA]);
  assert.equal(nested.status, 0, detail(nested));
  assert.deepEqual(nested.json.permissions, {
    requested: ["llm.embed", "llm.chat", "desktop.browser"],
    granted: ["llm.chat", "llm.embed"],
    denied: ["desktop.browser"],
    pending: [],
    lastPromptedAt: null,
  });
  // A recorded need this build's manifest no longer lists is not asked for, so it is never pending.
  writeFileSync(
    join(devRoot, slotA, ".launcher", "needs.json"),
    JSON.stringify({ ...needsFile(slotA), needs: [...needsFile(slotA).needs, "retired.permission"] }),
  );
  assert.deepEqual((await qa(["status", "--worktree", wtA])).json.permissions.pending, []);
  const nestedUp = await qa(["up", "--worktree", wtA, "--needs", "llm.chat,llm.embed"], { SIGNALS_QA_PERMISSION_WAIT_MS: "2000" });
  assert.equal(nestedUp.status, 0, detail(nestedUp));
  assert.deepEqual(nestedUp.json.permissions.granted, ["llm.chat", "llm.embed"]);

  const mismatch = await qa(["up", "--worktree", wtA, "--profile", "snapshot"]);
  assert.equal(mismatch.json.errorCode, "PROFILE_MISMATCH");
  assert.match(mismatch.json.next, /remove --worktree /);

  // ---- The installed app must not change while a slot is up --------------------------------------
  packagedSql("insert into local_apps (id, display_name, name, config, tags, status) values ('stray', 'Signals Dev · stray', 'stray', '{}', '[]', 'stopped');");
  const polluted = await qa(["down", "--worktree", wtA]);
  assert.equal(polluted.json.errorCode, "PACKAGED_HOST_CHANGED");
  assert.deepEqual(polluted.json.packagedHostDiff.added.map((row) => row.id), ["stray"]);
  assert.match(polluted.json.next, /tell the owner/);
  assert.match(polluted.json.next, /--accept-packaged-change$/);
  assert.equal(existsSync(sessionPath(slotA)), true);
  // Without the owner's confirmation every later down keeps failing; once they confirm, the flag
  // re-baselines and the next up snapshots the installed app as it now is.
  assert.equal((await qa(["down", "--worktree", wtA])).json.errorCode, "PACKAGED_HOST_CHANGED");
  const accepted = await qa(["down", "--worktree", wtA, "--accept-packaged-change"]);
  assert.equal(accepted.status, 0, detail(accepted));
  assert.equal(accepted.json.acceptedPackagedChange, true);
  assert.deepEqual(accepted.json.packagedHostDiff.added.map((row) => row.id), ["stray"]);
  assert.equal(existsSync(sessionPath(slotA)), false);
  assert.equal((await qa(["up", "--worktree", wtA])).status, 0);
  assert.equal((await qa(["down", "--worktree", wtA])).status, 0, "the re-baselined snapshot includes the owner's app");
  await qa(["up", "--worktree", wtA]);
  packagedSql("delete from local_apps where id = 'stray';");
  assert.equal((await qa(["down", "--worktree", wtA, "--accept-packaged-change"])).json.acceptedPackagedChange, true);
  await qa(["up", "--worktree", wtA]);
  assert.equal((await qa(["down", "--worktree", wtA])).status, 0);
  await qa(["up", "--worktree", wtA]);
  // A marketplace update of the canonical app is not pollution; a broken shape is an incident.
  packagedSql(`update local_apps set config = ${sql(canonicalConfig("0.2.22"))} where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`);
  packagedSql("insert into workspaces (slug) values ('signals-new');");
  const updated = await qa(["down", "--worktree", wtA]);
  assert.equal(updated.status, 0, detail(updated));
  assert.equal(updated.json.warnings.length, 2);
  await qa(["up", "--worktree", wtA]);
  packagedSql(`update local_apps set config = ${sql(canonicalConfig("0.2.22", { SIGNALS_DATA_DIR: "/tmp/elsewhere" }))} where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`);
  const broken = await qa(["down", "--worktree", wtA]);
  assert.equal(broken.json.errorCode, "CANONICAL_CHANGED");
  assert.match(broken.json.next, /incident/);
  assert.equal((await qa(["down", "--worktree", wtA, "--accept-packaged-change"])).json.errorCode, "CANONICAL_CHANGED", "the flag never accepts a broken canonical record");
  packagedSql(`update local_apps set config = ${sql(canonicalConfig("0.2.22"))} where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`);
  assert.equal((await qa(["down", "--worktree", wtA])).status, 0);

  // ---- Start failures -----------------------------------------------------------------------------
  const blocker = await listen(first.json.port);
  const busyPort = await qa(["up", "--worktree", wtA]);
  await new Promise((resolveClose) => blocker.close(resolveClose));
  assert.equal(busyPort.json.errorCode, "PORT_MISMATCH");
  assert.equal(busyPort.json.pinnedPort, first.json.port);

  const unguarded = await qa(["up", "--worktree", wtA], { MOCK_HEALTH: "unguarded" });
  assert.equal(unguarded.json.errorCode, "INSTANCE_UNGUARDED");
  assert.equal(unguarded.json.stopped, true);
  assert.match(unguarded.json.next, /Merge main/);
  assert.equal(mockState().apps.find((app) => app.id === appA).runtime.status, "stopped");

  const crashed = await qa(["up", "--worktree", wtA], { MOCK_STATUS: "crashed" });
  assert.equal(crashed.json.errorCode, "START_FAILED");
  assert.deepEqual(crashed.json.logs, ["err boom: port in use"]);
  assert.match(crashed.json.next, /down --worktree/);

  const silent = await qa(["up", "--worktree", wtA, "--timeout-ms", "1500"], { MOCK_NO_SPAWN: "1" });
  assert.equal(silent.json.errorCode, "HEALTH_TIMEOUT");
  // A running app that has not answered yet is usually still compiling: rerun up, not down (#543).
  assert.match(silent.json.next, /^The app is running .* Rerun node \S+ up --worktree \S+ .* --timeout-ms 600000, which reuses the app/);
  assert.equal((await qa(["down", "--worktree", wtA])).status, 0);

  // ---- Orphaned slot: the row was deleted in the UI while the receipt stayed ----------------------
  dropMockApp(appA);
  const orphaned = await qa(["up", "--worktree", wtA]);
  assert.equal(orphaned.json.errorCode, "SLOT_ORPHANED");
  assert.match(orphaned.json.next, /remove --worktree .* --keep-data, then rerun up/);
  writeFileSync(join(devRoot, slotA, "evidence.txt"), "kept\n");
  const keep = await qa(["remove", "--worktree", wtA, "--keep-data"]);
  assert.equal(keep.status, 0, detail(keep));
  assert.equal(keep.json.appDeleted, false);
  assert.equal(existsSync(join(devRoot, slotA, "evidence.txt")), true);
  assert.equal(existsSync(join(devRoot, slotA, ".launcher", "receipt.json")), false);
  const recreated = await qa(["up", "--worktree", wtA]);
  assert.equal(recreated.status, 0, detail(recreated));
  assert.equal(recreated.json.reused, false);
  assert.notEqual(recreated.json.appId, appA);
  assert.equal(existsSync(join(devRoot, slotA, "evidence.txt")), true);

  // A name taken by an app with no receipt for this checkout is not adopted.
  const wtD = addWorktree("loop-issue-80-dddd", "issue-80");
  addMockApp({ id: "squatter", displayName: "Signals Dev · loop-issue-80-dddd", tags: ["signals", "dev", "slot-loop-issue-80-dddd"], persistedStatus: "stopped" }, { config: {} });
  assert.equal((await qa(["up", "--worktree", wtD])).json.errorCode, "NAME_TAKEN");
  dropMockApp("squatter");

  // ---- Snapshot profile ---------------------------------------------------------------------------
  const realBefore = readFileSync(join(realData, "data.db"));
  const snap = await qa(["up", "--worktree", wtB, "--profile", "snapshot"]);
  assert.equal(snap.status, 0, detail(snap));
  const slotB = snap.json.slot;
  const slotBData = join(devRoot, slotB);
  assert.equal(snap.json.profile, "snapshot");
  assert.deepEqual(receiptFor(slotB).copied, ["data.db", "media"]);
  assert.equal(execFileSync("sqlite3", [join(slotBData, "data.db"), "select coalesce(credentials_encrypted, 'NULL') || '|' || status from platform_accounts;"], { encoding: "utf8" }).trim(), "NULL|needs_reauth");
  assert.equal(execFileSync("sqlite3", [join(slotBData, "data.db"), "select status from scheduled_jobs;"], { encoding: "utf8" }).trim(), "pending");
  assert.equal(existsSync(join(slotBData, "media", "avatar.png")), true);
  assert.equal(existsSync(join(slotBData, "browser-profiles")), false);
  assert.equal(existsSync(join(slotBData, "config.json")), false);
  assert.deepEqual(readFileSync(join(realData, "data.db")), realBefore);
  const keepB = await qa(["remove", "--worktree", wtB, "--keep-data"]);
  assert.equal(keepB.status, 0, detail(keepB));
  const appsBefore = mockState().apps.length;
  const exists = await qa(["up", "--worktree", wtB, "--profile", "snapshot"]);
  assert.equal(exists.json.errorCode, "SLOT_DATA_EXISTS");
  assert.equal(mockState().apps.length, appsBefore);
  const removeB = await qa(["remove", "--worktree", wtB]);
  assert.equal(removeB.status, 0, detail(removeB));
  assert.equal(removeB.json.dataRemoved, true);
  assert.equal(existsSync(slotBData), false);

  // ---- remove at loop close -----------------------------------------------------------------------
  devSql(`insert into workspaces (slug) values (${sql(`signals-dev-${slotA}`)});`);
  const removeA = await qa(["remove", "--worktree", wtA]);
  assert.equal(removeA.status, 0, detail(removeA));
  assert.equal(removeA.json.appDeleted, true);
  assert.equal(removeA.json.dataRemoved, true);
  assert.match(removeA.json.warnings.join(), /keeps workspace signals-dev-loop-issue-77-aaaa/);
  assert.equal(existsSync(join(devRoot, slotA)), false);
  assert.equal(mockState().apps.some((app) => app.id === recreated.json.appId), false);

  // ---- prune: gone checkouts, and the pre-#541 per-issue QA apps ----------------------------------
  // A dev-tagged row the launcher did not make (no SIGNALS_DEV_WORKTREE) is never planned, and a
  // row pointing at a non-slot directory or with an unclean slot tag cannot widen what is deleted.
  addMockApp({ id: "foreign-dev", displayName: "Signals Dev · foreign", tags: ["signals", "dev", "slot-foreign"], persistedStatus: "stopped" }, { config: { env: { SIGNALS_DATA_DIR: join(devRoot, "foreign") } } });
  mkdirSync(join(devRoot, "_backups"), { recursive: true });
  writeFileSync(join(devRoot, "_backups", "keep.json"), "{}");
  addMockApp(
    { id: "odd-dev", displayName: "Signals Dev · odd", tags: ["signals", "dev", "slot-../../x"], persistedStatus: "stopped" },
    { config: { env: { SIGNALS_DEV_WORKTREE: "/gone/odd", SIGNALS_DATA_DIR: join(devRoot, "_backups") } } },
  );
  const hardened = await qa(["prune"]);
  assert.deepEqual(hardened.json.skipped.map((item) => item.appId), ["foreign-dev"]);
  const odd = hardened.json.plan.find((item) => item.appId === "odd-dev");
  assert.equal(odd.slot, null);
  assert.equal(odd.dataDir, null);
  assert.equal((await qa(["prune", "--apply"])).status, 0);
  assert.equal(existsSync(join(devRoot, "_backups", "keep.json")), true);
  dropMockApp("foreign-dev");
  const wtC = addWorktree("loop-issue-79-cccc", "issue-79");
  const created = await qa(["up", "--worktree", wtC, "--no-start"]);
  assert.equal(created.status, 0, detail(created));
  assert.equal(created.json.started, false);
  execFileSync("git", ["worktree", "remove", "--force", wtC], { cwd: repo });
  mkdirSync(legacyQaData, { recursive: true });
  addMockApp(
    { id: "legacy-384", displayName: `Signals issue-9${legacyTag} QA`, tags: ["signals", "qa", "ephemeral"], persistedStatus: "stopped" },
    { config: { env: { SIGNALS_DATA_DIR: legacyQaData, SIGNALS_QA_WORKTREE: "/gone/worktree" } } },
  );
  addMockApp(
    { id: "legacy-159", displayName: "Signals issue-159 QA", tags: [], persistedStatus: "stopped" },
    { config: { working_dir: "/gone/loop-issue-159", home_url: "http://localhost:3010/dashboard", env: { SIGNALS_DATA_DIR: "/private/tmp/signals-issue-159-qa-data" } } },
  );
  addMockApp(
    { id: "legacy-real", displayName: "Signals issue-1 QA", tags: [], persistedStatus: "stopped" },
    { config: { env: { SIGNALS_DATA_DIR: "~/.signals" } } },
  );
  const plan = await qa(["prune"]);
  assert.equal(plan.status, 0, detail(plan));
  assert.equal(plan.json.applied, false);
  assert.deepEqual(plan.json.plan.map((item) => item.kind), ["dev-app"]);
  assert.equal(plan.json.plan[0].appId, created.json.appId);
  assert.equal(plan.json.plan[0].dataDir, join(devRoot, "loop-issue-79-cccc"));
  const legacyPlan = await qa(["prune", "--legacy-qa"]);
  assert.deepEqual(legacyPlan.json.plan.map((item) => item.appId).sort(), [created.json.appId, "legacy-159", "legacy-384"].sort());
  assert.deepEqual(legacyPlan.json.skipped.map((item) => item.appId), ["legacy-real"]);
  assert.equal(legacyPlan.json.plan.find((item) => item.appId === "legacy-384").dataDir, legacyQaData);
  assert.equal(legacyPlan.json.plan.find((item) => item.appId === "legacy-159").dataLeftInPlace, "/private/tmp/signals-issue-159-qa-data");
  assert.equal((await qa(["status", "--worktree", repo])).json.staleSlots.total, 3);
  const applied = await qa(["prune", "--legacy-qa", "--apply"]);
  assert.equal(applied.status, 0, detail(applied));
  assert.equal(applied.json.removed.length, 3);
  assert.deepEqual(mockState().apps.map((app) => app.id).sort(), [mainUp.json.appId, "legacy-real"].sort());
  assert.equal(existsSync(join(devRoot, "loop-issue-79-cccc")), false);
  assert.equal(existsSync(legacyQaData), false);
  dropMockApp("legacy-real");
  assert.equal((await qa(["remove", "--worktree", repo])).status, 0);

  // ---- Slice-1 migration --------------------------------------------------------------------------
  const migRoot = join(root, "mig");
  const migDb = join(migRoot, "dev", "users", "tester", "storage", "realtimex.db");
  const migState = join(migRoot, "local-apps.json");
  const migDevRoot = join(migRoot, "signals-dev");
  mkdirSync(join(dirname(migDb), "local-apps"), { recursive: true });
  // RealTimeX keeps realtimex.db in WAL mode, and a .backup copy keeps it: a plain -readonly open
  // of the copy fails because it cannot create the copy's -shm.
  execFileSync("sqlite3", [migDb, `pragma journal_mode = wal; ${appsTable}`]);
  const storageLink = join(dirname(migDb), "local-apps", CANONICAL_SIGNALS_APP_ID);
  symlinkSync(repo, storageLink);
  const migEnv = { MOCK_LOCAL_APPS_STATE: migState, MOCK_DEV_DB: migDb, SIGNALS_DEV_ROOT: migDevRoot };
  const migSql = (statement) => execFileSync("sqlite3", [migDb, statement], { encoding: "utf8" }).trim();
  writeFileSync(migState, JSON.stringify({ apps: [{ id: CANONICAL_SIGNALS_APP_ID, displayName: "Signals", tags: [], persistedStatus: "stopped", runtime: { status: "stopped" } }] }));
  migSql(
    "insert into local_apps (id, display_name, name, config, tags, status, metadata) values (" +
      [CANONICAL_SIGNALS_APP_ID, "Signals", "signals", JSON.stringify(legacyConfig), "[]", "stopped", JSON.stringify({ permissions: { granted: requested, denied: [] } })].map(sql).join(", ") +
      ");",
  );
  const migrate = (args, env = {}) => run(migrator, [...args, "--db", migDb, "--main-checkout", repo, "--packaged-db", packagedDb], { ...migEnv, ...env });
  assert.equal((await migrate(["--help"])).status, 0);
  assert.equal((await run(migrator, ["--plan", "--db", devDb])).json.errorCode, "HOST_PACKAGED_FORBIDDEN");
  const planned = await migrate(["--plan", "--cli", mockCli]);
  assert.equal(planned.status, 0, detail(planned));
  assert.match(planned.json.rowSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(planned.json.blockers, []);
  assert.equal(planned.json.steps.length, 6);
  // Another unsafe row blocks the change before anything is written.
  migSql(`insert into local_apps (id, display_name, name, config, tags, status) values ('legacy-184', 'Signals issue-184 QA', 'q', ${sql(JSON.stringify({ home_url: "http://localhost:3010/dashboard" }))}, '[]', 'stopped');`);
  const blockedPlan = await migrate(["--plan"]);
  assert.equal(blockedPlan.json.blockers.length, 1);
  assert.match(blockedPlan.json.next, /prune --legacy-qa --apply/);
  const blocked = await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256]);
  assert.equal(blocked.json.errorCode, "DEV_HOST_UNSAFE");
  assert.equal(existsSync(join(migDevRoot, "_backups")), false);
  migSql("delete from local_apps where id = 'legacy-184';");
  const legacyPresent = () => migSql(`select count(*) from local_apps where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`) === "1";

  // Anything the launcher would refuse is found before the delete (Review F1): a live next dev in
  // the main checkout, or a leftover slot-main receipt. Plan reports it; apply writes nothing.
  const mainLockHolder = track(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "next-server-main-lock"]));
  mkdirSync(join(repo, ".next", "dev"), { recursive: true });
  writeFileSync(join(repo, ".next", "dev", "lock"), JSON.stringify({ pid: mainLockHolder.pid, port: 4998 }));
  const lockedPlan = await migrate(["--plan", "--cli", mockCli]);
  assert.match(lockedPlan.json.blockers.join(), /next dev \(pid \d+\) holds/);
  assert.equal(lockedPlan.json.managementVerified, true);
  const lockedApply = await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256]);
  assert.equal(lockedApply.json.errorCode, "SLOT_NOT_FRESH");
  assert.match(lockedApply.json.next, /^Nothing was changed\./);
  assert.equal(legacyPresent(), true);
  assert.equal(existsSync(storageLink), true);
  assert.equal(existsSync(join(migDevRoot, "_backups")), false);
  await stopChild(mainLockHolder);
  rmSync(join(repo, ".next"), { recursive: true, force: true });
  const leftover = join(migDevRoot, "main", ".launcher");
  mkdirSync(leftover, { recursive: true });
  writeFileSync(join(leftover, "receipt.json"), JSON.stringify({ worktree: repo, appId: "gone" }));
  assert.match((await migrate(["--plan"])).json.blockers.join(), /slot main already has a receipt/);
  assert.equal((await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256])).json.errorCode, "SLOT_NOT_FRESH");
  assert.equal(legacyPresent(), true);
  rmSync(join(migDevRoot, "main"), { recursive: true, force: true });
  // The row is only changed with the approved hash, and only when the host says it is stopped.
  assert.equal((await migrate(["--cli", mockCli])).json.errorCode, "USAGE");
  assert.equal((await migrate(["--expect-row-sha256", planned.json.rowSha256])).json.errorCode, "USAGE");
  assert.equal((await migrate(["--cli", mockCli, "--expect-row-sha256", "0".repeat(64)])).json.errorCode, "ROW_CHANGED");
  const setLegacyRuntime = (runtime) => {
    const state = JSON.parse(readFileSync(migState, "utf8"));
    state.apps[0].runtime = runtime;
    writeFileSync(migState, JSON.stringify(state));
  };
  setLegacyRuntime({ status: "running" });
  assert.match((await migrate(["--plan", "--cli", mockCli])).json.blockers.join(), /runtime status is running/);
  assert.equal((await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256])).json.errorCode, "ROW_RUNNING");
  // An unknown status fails closed (Review F5).
  setLegacyRuntime(null);
  assert.equal((await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256])).json.errorCode, "ROW_STATUS_UNKNOWN");
  setLegacyRuntime({ status: "stopped" });
  assert.equal(legacyPresent(), true);
  assert.equal(existsSync(join(migDevRoot, "_backups")), false);

  const migrated = await migrate(["--cli", mockCli, "--expect-row-sha256", planned.json.rowSha256]);
  assert.equal(migrated.status, 0, detail(migrated));
  assert.equal(migrated.json.removedAppId, CANONICAL_SIGNALS_APP_ID);
  assert.equal(migrated.json.symlink.action, "unlinked");
  assert.equal(existsSync(storageLink), false);
  assert.equal(existsSync(repo), true);
  assert.equal(
    createHash("sha256").update(readFileSync(migrated.json.backups.row)).digest("hex"),
    planned.json.rowSha256,
  );
  assert.equal(execFileSync("sqlite3", [migrated.json.backups.database, `select display_name from local_apps where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`], { encoding: "utf8" }).trim(), "Signals");
  assert.equal(migSql(`select count(*) from local_apps where id = ${sql(CANONICAL_SIGNALS_APP_ID)};`), "0");
  const replacement = JSON.parse(execFileSync("sqlite3", ["-json", migDb, `select * from local_apps where id = ${sql(migrated.json.created.appId)};`], { encoding: "utf8" }))[0];
  assert.equal(replacement.display_name, "Signals Dev · main");
  const replacementConfig = JSON.parse(replacement.config);
  assert.equal(replacementConfig.env.SIGNALS_DATA_DIR, join(migDevRoot, "main"));
  assert.equal(replacementConfig.env.SIGNALS_INSTANCE, "dev");
  assert.notEqual(replacementConfig.env.PORT, "3010");
  assert.equal(JSON.parse(readFileSync(migState, "utf8")).apps.find((app) => app.id === migrated.json.created.appId).runtime.status, "stopped");
  assert.deepEqual(migrated.json.devHostProblems, []);
  const migratedAgain = await migrate(["--plan"]);
  assert.equal(migratedAgain.status, 0, detail(migratedAgain));
  assert.equal(migratedAgain.json.alreadyMigrated, true);

  assert.deepEqual(failuresWithoutNext, [], "every failure must carry a next");
  console.log("qa-local-app orchestrator: OK");
} finally {
  await Promise.all([...children].map((child) => stopChild(child)));
  killLoggedPids();
  rmSync(legacyQaData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}
