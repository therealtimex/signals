#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_SIGNALS_APP_ID,
  appsFromCliPayload,
  assertSafeQaApp,
  assertSafeQaDataDir,
  buildQaCreateCliArgs,
  canonicalSignalsRepoRoot,
  canonicalConfigProblems,
  defaultQaDataDir,
  findIssueQaApps,
  parseCliJson,
  qaAppDisplayName,
  qaAppTags,
  qaReceiptPath,
  qaTemporaryRoot,
} from "./signals-qa-local-app.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(scriptDir));

assert.equal(qaAppDisplayName("#356"), "Signals issue-356 QA");
assert.deepEqual(qaAppTags("356"), ["signals", "qa", "ephemeral", "issue-356"]);
assert.equal(qaTemporaryRoot("darwin", "/ignored"), "/private/tmp");
assert.equal(qaTemporaryRoot("linux", "/tmp"), "/tmp");
const contractDataDir = defaultQaDataDir("356");
assert.equal(assertSafeQaDataDir(contractDataDir), contractDataDir);
assert.throws(() => assertSafeQaDataDir("~/.signals"), /signals-qa-\*/);

const safeApp = {
  id: "qa-app-id",
  displayName: "Signals issue-356 QA",
  tags: ["signals", "qa", "ephemeral", "issue-356"],
};
assert.equal(assertSafeQaApp(safeApp, "356"), safeApp);
assert.throws(
  () => assertSafeQaApp({ ...safeApp, id: CANONICAL_SIGNALS_APP_ID }, "356"),
  /canonical Signals/,
);
assert.throws(
  () => assertSafeQaApp({ ...safeApp, tags: ["signals", "qa", "issue-356"] }, "356"),
  /missing safety tag ephemeral/,
);

const cliPayload = parseCliJson(
  'notice\n{"meta":{"source":"live"},"results":{"apps":[{"id":"qa-app-id","displayName":"Signals issue-356 QA","tags":["signals","qa","ephemeral","issue-356"]}]}}',
);
assert.equal(appsFromCliPayload(cliPayload).length, 1);
assert.equal(findIssueQaApps(appsFromCliPayload(cliPayload), "356")[0].id, "qa-app-id");

const createArgs = buildQaCreateCliArgs({
  issueId: "356",
  worktree: "/tmp/loop-issue-356",
  dataDir: contractDataDir,
  loopId: "loop-issue-356-example",
  baseUrl: "http://127.0.0.1:3101/cli",
});
assert.equal(createArgs[0], "create-local-app");
assert.ok(createArgs.includes("Signals issue-356 QA"));
assert.ok(createArgs.includes("signals,qa,ephemeral,issue-356,loop-issue-356-example"));
const envJson = createArgs[createArgs.indexOf("--env") + 1];
const env = JSON.parse(envJson);
assert.equal(env.SIGNALS_QA_WORKTREE, "/tmp/loop-issue-356");
assert.equal(env.SIGNALS_DATA_DIR, contractDataDir);

const cleanCanonical = {
  id: CANONICAL_SIGNALS_APP_ID,
  display_name: "Signals",
  config: JSON.stringify({
    command: "/node/bin/npm",
    args: ["run", "dev"],
    working_dir: "/repo/signals",
    env: { SIGNALS_DATA_DIR: "~/.signals" },
  }),
};
assert.deepEqual(canonicalConfigProblems(cleanCanonical, "/repo/signals"), []);
assert.deepEqual(
  canonicalConfigProblems(
    {
      ...cleanCanonical,
      config: JSON.stringify({
        command: "/node/bin/node",
        args: ["/tmp/worktrees/issue-356/node_modules/next", "dev"],
        working_dir: "/repo/signals",
        env: { SIGNALS_DATA_DIR: "/private/tmp/signals-qa-issue-356-data" },
      }),
    },
    "/repo/signals",
  ),
  [
    "canonical SIGNALS_DATA_DIR is not ~/.signals",
    "canonical command or args reference ephemeral QA state",
  ],
);

for (const script of [
  "provision-signals-qa-local-app.mjs",
  "cleanup-signals-qa-local-app.mjs",
  "verify-signals-local-app-hygiene.mjs",
]) {
  const result = spawnSync(process.execPath, [join(scriptDir, script), "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

const recoveryWithoutGuard = spawnSync(
  process.execPath,
  [join(scriptDir, "provision-signals-local-app.mjs")],
  { encoding: "utf8" },
);
assert.equal(recoveryWithoutGuard.status, 2);
assert.match(recoveryWithoutGuard.stderr, /without --restore-canonical/);

const launcherPackage = JSON.parse(
  readFileSync(join(scriptDir, "signals-qa-local-app-launcher", "package.json"), "utf8"),
);
assert.equal(launcherPackage.scripts.start, "node launcher.mjs");
assert.equal(repoRoot.endsWith("signals"), true);

const lifecycleRoot = mkdtempSync(join(tmpdir(), "signals-qa-local-app-test-"));
const lifecycleIssue = String(Date.now());
const lifecycleRepo = join(lifecycleRoot, "repo");
const lifecycleWorktree = join(lifecycleRoot, "worktree");
const lifecycleData = defaultQaDataDir(lifecycleIssue);
const lifecycleReceipt = qaReceiptPath(lifecycleIssue);
const mockStatePath = join(lifecycleRoot, "local-apps.json");
const mockCliPath = join(lifecycleRoot, "mock-realtimex-pp-cli.mjs");

try {
  mkdirSync(lifecycleRepo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: lifecycleRepo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "qa-test@example.invalid"], {
    cwd: lifecycleRepo,
  });
  execFileSync("git", ["config", "user.name", "Signals QA Test"], { cwd: lifecycleRepo });
  writeFileSync(
    join(lifecycleRepo, "package.json"),
    `${JSON.stringify({ name: "@realtimex/signals", private: true }, null, 2)}\n`,
  );
  execFileSync("git", ["add", "package.json"], { cwd: lifecycleRepo });
  execFileSync("git", ["commit", "-m", "test fixture"], {
    cwd: lifecycleRepo,
    stdio: "ignore",
  });
  execFileSync("git", ["worktree", "add", "-b", `issue-${lifecycleIssue}`, lifecycleWorktree], {
    cwd: lifecycleRepo,
    stdio: "ignore",
  });
  assert.equal(canonicalSignalsRepoRoot(lifecycleWorktree), realpathSync(lifecycleRepo));

  writeFileSync(
    mockStatePath,
    `${JSON.stringify({
      apps: [
        {
          id: CANONICAL_SIGNALS_APP_ID,
          displayName: "Signals",
          tags: [],
          persistedStatus: "running",
        },
      ],
    })}\n`,
  );
  writeFileSync(
    mockCliPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const statePath = process.env.MOCK_LOCAL_APPS_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const command = args[0];
const value = (flag) => args[args.indexOf(flag) + 1];
const save = () => writeFileSync(statePath, JSON.stringify(state));
let results;
if (command === "list-local-apps") {
  results = { apps: state.apps };
} else if (command === "create-local-app") {
  const app = {
    id: "qa-created-app",
    displayName: value("--display-name"),
    tags: value("--tags").split(","),
    persistedStatus: "stopped",
    runtime: { status: "stopped" },
  };
  state.apps.push(app);
  save();
  results = { app };
} else if (command === "start-local-app") {
  results = { success: true, appId: args[1] };
} else if (command === "get-local-app-status") {
  results = { success: true, appId: args[1], runtime: { status: "running" } };
} else if (command === "stop-local-app") {
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
  chmodSync(mockCliPath, 0o755);

  const childEnv = { ...process.env, MOCK_LOCAL_APPS_STATE: mockStatePath };
  const provisionResult = spawnSync(
    process.execPath,
    [
      join(scriptDir, "provision-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--worktree",
      lifecycleWorktree,
      "--data-dir",
      lifecycleData,
      "--cli",
      mockCliPath,
      "--no-start",
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(provisionResult.status, 0, provisionResult.stderr);
  assert.equal(existsSync(lifecycleReceipt), true);
  const lifecycleReceiptData = JSON.parse(readFileSync(lifecycleReceipt, "utf8"));
  assert.equal(lifecycleReceiptData.baseUrl, "http://127.0.0.1:3101/cli");
  let lifecycleState = JSON.parse(readFileSync(mockStatePath, "utf8"));
  assert.equal(lifecycleState.apps.length, 2);
  assert.equal(lifecycleState.apps[0].id, CANONICAL_SIGNALS_APP_ID);
  assert.equal(lifecycleState.apps[1].displayName, `Signals issue-${lifecycleIssue} QA`);

  mkdirSync(lifecycleData, { recursive: true });
  writeFileSync(join(lifecycleData, "ephemeral.txt"), "qa only\n");
  const cleanupResult = spawnSync(
    process.execPath,
    [
      join(scriptDir, "cleanup-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--cli",
      mockCliPath,
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(cleanupResult.status, 0, cleanupResult.stderr);
  lifecycleState = JSON.parse(readFileSync(mockStatePath, "utf8"));
  assert.deepEqual(lifecycleState.apps.map((app) => app.id), [CANONICAL_SIGNALS_APP_ID]);
  assert.equal(existsSync(lifecycleReceipt), false);
  assert.equal(existsSync(lifecycleData), false);
} finally {
  rmSync(lifecycleReceipt, { force: true });
  rmSync(lifecycleData, { recursive: true, force: true });
  rmSync(lifecycleRoot, { recursive: true, force: true });
}

const sqliteAvailable = spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;
if (sqliteAvailable) {
  const verifierRoot = mkdtempSync(join(tmpdir(), "signals-qa-hygiene-test-"));
  const verifierDb = join(verifierRoot, "realtimex.db");
  const verifierIssue = String(Date.now() + 1);
  const verifierConfig = JSON.stringify({
    command: "/node/bin/npm",
    args: ["run", "dev"],
    working_dir: "/repo/signals",
    env: { SIGNALS_DATA_DIR: "~/.signals" },
  }).replaceAll("'", "''");
  try {
    execFileSync("sqlite3", [
      verifierDb,
      `CREATE TABLE local_apps (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        tags TEXT,
        status TEXT NOT NULL
      );
      INSERT INTO local_apps VALUES (
        '${CANONICAL_SIGNALS_APP_ID}', 'Signals', 'signals', '${verifierConfig}', '[]', 'stopped'
      );`,
    ]);
    const verifierArgs = [
      join(scriptDir, "verify-signals-local-app-hygiene.mjs"),
      "--issue",
      verifierIssue,
      "--db",
      verifierDb,
      "--canonical-repo",
      "/repo/signals",
    ];
    const cleanResult = spawnSync(process.execPath, verifierArgs, { encoding: "utf8" });
    assert.equal(cleanResult.status, 0, cleanResult.stderr);

    execFileSync("sqlite3", [
      verifierDb,
      `INSERT INTO local_apps VALUES (
        'qa-leftover', 'Renamed disposable app', 'signals-issue-${verifierIssue}-qa',
        '{}', '["qa","issue-${verifierIssue}"]', 'stopped'
      );`,
    ]);
    const dirtyResult = spawnSync(process.execPath, verifierArgs, { encoding: "utf8" });
    assert.equal(dirtyResult.status, 1);
    assert.match(dirtyResult.stderr, /issue-specific QA Local App record/);
  } finally {
    rmSync(verifierRoot, { recursive: true, force: true });
  }
}

console.log("OK: Signals QA Local App isolation and teardown contracts verified");
