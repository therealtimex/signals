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
  assertIssueBoundQaDataDir,
  assertIssueScopedQaWorkspaceSlug,
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
assert.equal(assertIssueBoundQaDataDir(contractDataDir, "356"), contractDataDir);
assert.throws(
  () => assertIssueBoundQaDataDir(defaultQaDataDir("357"), "356"),
  /must include issue-356/,
);
assert.throws(() => assertSafeQaDataDir("~/.signals"), /signals-qa-\*/);
assert.equal(
  assertIssueScopedQaWorkspaceSlug("signals-issue-356-experience-qa", "356"),
  "signals-issue-356-experience-qa",
);
assert.equal(assertIssueScopedQaWorkspaceSlug("", "356"), null);
assert.throws(
  () => assertIssueScopedQaWorkspaceSlug("signals-issue-357-experience-qa", "356"),
  /must start with signals-issue-356-/,
);
assert.throws(
  () => assertIssueScopedQaWorkspaceSlug("Signals issue 356", "356"),
  /lowercase kebab-case/,
);

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
  workspaceSlug: "signals-issue-356-experience-qa",
});
assert.equal(createArgs[0], "create-local-app");
assert.ok(createArgs.includes("Signals issue-356 QA"));
assert.ok(createArgs.includes("signals,qa,ephemeral,issue-356,loop-issue-356-example"));
const envJson = createArgs[createArgs.indexOf("--env") + 1];
const env = JSON.parse(envJson);
assert.equal(env.SIGNALS_QA_WORKTREE, "/tmp/loop-issue-356");
assert.equal(env.SIGNALS_DATA_DIR, contractDataDir);
assert.equal(env.SIGNALS_RTX_WORKSPACE_SLUG, "signals-issue-356-experience-qa");

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
const repoPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assert.equal(repoPackage.name, "@realtimex/signals");

const lifecycleRoot = mkdtempSync(join(tmpdir(), "signals-qa-local-app-test-"));
const lifecycleIssue = String(Date.now());
const lifecycleRepo = join(lifecycleRoot, "repo");
const lifecycleWorktree = join(lifecycleRoot, "worktree");
const lifecycleData = defaultQaDataDir(lifecycleIssue);
const lifecycleReceipt = qaReceiptPath(lifecycleIssue);
const otherIssueData = defaultQaDataDir(`${lifecycleIssue}1`);
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
  if (process.env.MOCK_DELETE_FAIL_AFTER_COMMIT === "1") {
    console.error("Simulated response loss after committed delete");
    process.exit(1);
  }
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
      "--workspace-slug",
      `signals-issue-${lifecycleIssue}-experience-qa`,
      "--no-start",
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(provisionResult.status, 0, provisionResult.stderr);
  assert.equal(existsSync(lifecycleReceipt), true);
  const lifecycleReceiptData = JSON.parse(readFileSync(lifecycleReceipt, "utf8"));
  assert.equal(lifecycleReceiptData.baseUrl, "http://127.0.0.1:3101/cli");
  assert.equal(
    lifecycleReceiptData.workspaceSlug,
    `signals-issue-${lifecycleIssue}-experience-qa`,
  );
  let lifecycleState = JSON.parse(readFileSync(mockStatePath, "utf8"));
  assert.equal(lifecycleState.apps.length, 2);
  assert.equal(lifecycleState.apps[0].id, CANONICAL_SIGNALS_APP_ID);
  assert.equal(lifecycleState.apps[1].displayName, `Signals issue-${lifecycleIssue} QA`);

  mkdirSync(lifecycleData, { recursive: true });
  writeFileSync(join(lifecycleData, "ephemeral.txt"), "qa only\n");

  const mismatchedAppCleanup = spawnSync(
    process.execPath,
    [
      join(scriptDir, "cleanup-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--app-id",
      "wrong-qa-app",
      "--cli",
      mockCliPath,
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(mismatchedAppCleanup.status, 1);
  assert.match(mismatchedAppCleanup.stderr, /--app-id conflicts with the receipt/);
  assert.equal(existsSync(lifecycleReceipt), true);
  assert.equal(existsSync(lifecycleData), true);

  mkdirSync(otherIssueData, { recursive: true });
  writeFileSync(join(otherIssueData, "other-issue.txt"), "must survive\n");
  const mismatchedDataCleanup = spawnSync(
    process.execPath,
    [
      join(scriptDir, "cleanup-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--data-dir",
      otherIssueData,
      "--cli",
      mockCliPath,
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(mismatchedDataCleanup.status, 1);
  assert.match(mismatchedDataCleanup.stderr, /--data-dir conflicts with the receipt/);
  assert.equal(existsSync(lifecycleReceipt), true);
  assert.equal(existsSync(lifecycleData), true);
  assert.equal(existsSync(otherIssueData), true);

  const interruptedCleanup = spawnSync(
    process.execPath,
    [
      join(scriptDir, "cleanup-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--cli",
      mockCliPath,
    ],
    {
      encoding: "utf8",
      env: { ...childEnv, MOCK_DELETE_FAIL_AFTER_COMMIT: "1" },
    },
  );
  assert.equal(interruptedCleanup.status, 1);
  assert.match(interruptedCleanup.stderr, /Simulated response loss after committed delete/);
  assert.equal(existsSync(lifecycleReceipt), true);
  assert.equal(existsSync(lifecycleData), true);

  lifecycleState = JSON.parse(readFileSync(mockStatePath, "utf8"));
  assert.deepEqual(lifecycleState.apps.map((app) => app.id), [CANONICAL_SIGNALS_APP_ID]);
  const replacementIssueApp = {
    id: "qa-replacement-app",
    displayName: `Signals issue-${lifecycleIssue} QA`,
    tags: ["signals", "qa", "ephemeral", `issue-${lifecycleIssue}`],
    persistedStatus: "stopped",
  };
  writeFileSync(
    mockStatePath,
    `${JSON.stringify({ apps: [...lifecycleState.apps, replacementIssueApp] })}\n`,
  );
  const ambiguousRetryCleanup = spawnSync(
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
  assert.equal(ambiguousRetryCleanup.status, 1);
  assert.match(ambiguousRetryCleanup.stderr, /another issue-.* QA app remains/);
  assert.equal(existsSync(lifecycleReceipt), true);
  assert.equal(existsSync(lifecycleData), true);
  writeFileSync(mockStatePath, `${JSON.stringify({ apps: lifecycleState.apps })}\n`);

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
  const cleanupOutput = JSON.parse(cleanupResult.stdout);
  assert.equal(cleanupOutput.appDeleted, false);
  assert.equal(cleanupOutput.appAlreadyAbsent, true);
  lifecycleState = JSON.parse(readFileSync(mockStatePath, "utf8"));
  assert.deepEqual(lifecycleState.apps.map((app) => app.id), [CANONICAL_SIGNALS_APP_ID]);
  assert.equal(existsSync(lifecycleReceipt), false);
  assert.equal(existsSync(lifecycleData), false);

  const receiptlessForeignDataCleanup = spawnSync(
    process.execPath,
    [
      join(scriptDir, "cleanup-signals-qa-local-app.mjs"),
      "--issue",
      lifecycleIssue,
      "--data-dir",
      otherIssueData,
      "--cli",
      mockCliPath,
    ],
    { encoding: "utf8", env: childEnv },
  );
  assert.equal(receiptlessForeignDataCleanup.status, 1);
  assert.match(receiptlessForeignDataCleanup.stderr, /must include issue-/);
  assert.equal(existsSync(otherIssueData), true);
} finally {
  rmSync(lifecycleReceipt, { force: true });
  rmSync(lifecycleData, { recursive: true, force: true });
  rmSync(otherIssueData, { recursive: true, force: true });
  rmSync(lifecycleRoot, { recursive: true, force: true });
}

const sqliteAvailable = spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;
if (sqliteAvailable) {
  const recoveryRoot = mkdtempSync(join(tmpdir(), "signals-canonical-recovery-test-"));
  const recoveryUser = "qa-test-user";
  const productionDb = join(
    recoveryRoot,
    "app",
    "users",
    recoveryUser,
    "storage",
    "realtimex.db",
  );
  const devDb = join(
    recoveryRoot,
    "dev",
    "users",
    recoveryUser,
    "storage",
    "realtimex.db",
  );
  const recoverySchema = `CREATE TABLE local_apps (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    app_type TEXT NOT NULL DEFAULT 'node',
    config TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'stopped',
    is_configured INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT,
    updatedAt TEXT
  );`;
  try {
    mkdirSync(dirname(productionDb), { recursive: true });
    mkdirSync(dirname(devDb), { recursive: true });
    execFileSync("sqlite3", [
      productionDb,
      `${recoverySchema}
       INSERT INTO local_apps (id, display_name, name)
       VALUES ('${CANONICAL_SIGNALS_APP_ID}', 'Production Sentinel', 'signals');`,
    ]);
    execFileSync("sqlite3", [devDb, recoverySchema]);
    const recoveryEnv = {
      ...process.env,
      REALTIMEX_USER_DATA: recoveryRoot,
      REALTIMEX_USER: recoveryUser,
    };
    delete recoveryEnv.RTX_DB_PATH;
    delete recoveryEnv.REALTIMEX_STORAGE_ROOT;
    delete recoveryEnv.REALTIMEX_RUNTIME;
    const recoveryResult = spawnSync(
      process.execPath,
      [join(scriptDir, "provision-signals-local-app.mjs"), "--restore-canonical"],
      { encoding: "utf8", env: recoveryEnv },
    );
    assert.equal(recoveryResult.status, 0, recoveryResult.stderr);
    assert.ok(recoveryResult.stdout.includes(devDb));
    assert.equal(
      execFileSync(
        "sqlite3",
        [
          productionDb,
          `SELECT display_name FROM local_apps WHERE id = '${CANONICAL_SIGNALS_APP_ID}';`,
        ],
        { encoding: "utf8" },
      ).trim(),
      "Production Sentinel",
    );
    assert.equal(
      execFileSync(
        "sqlite3",
        [devDb, `SELECT display_name FROM local_apps WHERE id = '${CANONICAL_SIGNALS_APP_ID}';`],
        { encoding: "utf8" },
      ).trim(),
      "Signals",
    );

    const explicitAppDbEnv = { ...recoveryEnv, REALTIMEX_RUNTIME: "dev" };
    const explicitAppDbResult = spawnSync(
      process.execPath,
      [
        join(scriptDir, "provision-signals-local-app.mjs"),
        "--restore-canonical",
        "--db",
        productionDb,
      ],
      { encoding: "utf8", env: explicitAppDbEnv },
    );
    assert.equal(explicitAppDbResult.status, 0, explicitAppDbResult.stderr);
    const productionConfig = JSON.parse(
      execFileSync(
        "sqlite3",
        [productionDb, `SELECT config FROM local_apps WHERE id = '${CANONICAL_SIGNALS_APP_ID}';`],
        { encoding: "utf8" },
      ).trim(),
    );
    assert.equal(productionConfig.env.REALTIMEX_BASE_URL, "http://127.0.0.1:3001/cli");
  } finally {
    rmSync(recoveryRoot, { recursive: true, force: true });
  }

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
