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
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_SIGNALS_APP_ID,
  appsFromCliPayload,
  assertSafeQaDataDir,
  canonicalConfigProblems,
  canonicalSignalsRepoRoot,
  isCanonicalWorkingDir,
  legacyQaStatePaths,
  marketplaceDeployRoot,
  parseCliJson,
  qaAppDisplayName,
  qaTemporaryRoot,
  REALTIMEX_AUTH_ENV_KEYS,
  normalizeRealtimeXBaseUrl,
  realtimeXCliEnv,
} from "./signals-qa-local-app.mjs";
import {
  PORT_RANGE_SIZE,
  PORT_RANGE_START,
  RESERVED_PORTS,
  baseSlotFor,
  buildDevCreateCliArgs,
  choosePort,
  devAppDisplayName,
  devAppEnv,
  devAppTags,
  devHostProblems,
  diffPackagedHost,
  legacyQaIssueId,
  packagedHostFingerprint,
  pinnedPorts,
  pointsAtRealSignalsData,
  prepareSlotData,
  resolveSignalsCheckout,
  resolveSlot,
  sanitizeSlot,
  signalsDevRoot,
  slotAppProblems,
  slotPaths,
  slotReceiptForWorktree,
  worktreeHash,
} from "./signals-dev-local-app.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(scriptDir));

assert.equal(qaAppDisplayName("#356"), "Signals issue-356 QA");
assert.equal(qaTemporaryRoot("darwin", "/ignored"), "/private/tmp");
assert.equal(qaTemporaryRoot("linux", "/tmp"), "/tmp");
assert.equal(assertSafeQaDataDir(`${qaTemporaryRoot()}/signals-qa-issue-356-data`), `${qaTemporaryRoot()}/signals-qa-issue-356-data`);
assert.throws(() => assertSafeQaDataDir("~/.signals"), /signals-qa-\*/);
assert.deepEqual(legacyQaStatePaths("356").map((path) => path.split("/").pop()), [
  "signals-qa-local-app-issue-356.json",
  "signals-qa-local-app-issue-356.session.json",
  "signals-qa-local-app-issue-356.lock",
]);

// The installed app's credentials never travel to the Dev host; a Dev terminal keeps its own,
// unless an explicit --cli credential wrapper is in play.
const dev = "http://127.0.0.1:3101/cli";
const creds = { REALTIMEX_TERMINAL_SESSION_TOKEN: "t", REALTIMEX_APP_ID_AUTH: "a", REALTIMEX_CONFIG: "/c.toml" };
const credsOf = (env) => REALTIMEX_AUTH_ENV_KEYS.filter((key) => key in env);
const installedTerminal = { REALTIMEX_BASE_URL: "http://127.0.0.1:3001/cli", ...creds, OTHER: "kept" };
assert.deepEqual(credsOf(realtimeXCliEnv(dev, installedTerminal)), []);
assert.equal(realtimeXCliEnv(dev, installedTerminal).REALTIMEX_BASE_URL, dev);
assert.equal(realtimeXCliEnv(dev, installedTerminal).OTHER, "kept");
assert.deepEqual(credsOf(realtimeXCliEnv(dev, creds)), [], "an unknown issuer is another host");
const devTerminal = { ...creds, REALTIMEX_BASE_URL: "http://localhost:3101/cli/" };
assert.deepEqual(credsOf(realtimeXCliEnv(dev, devTerminal)), REALTIMEX_AUTH_ENV_KEYS);
assert.deepEqual(credsOf(realtimeXCliEnv(dev, devTerminal, { explicitCredential: true })), []);
assert.equal(installedTerminal.REALTIMEX_TERMINAL_SESSION_TOKEN, "t");
assert.equal(normalizeRealtimeXBaseUrl("http://localhost:3101/cli/"), normalizeRealtimeXBaseUrl(dev));
assert.notEqual(normalizeRealtimeXBaseUrl("http://127.0.0.1:3001/cli"), normalizeRealtimeXBaseUrl(dev));

const cliPayload = parseCliJson(
  'notice\n{"meta":{"source":"live"},"results":{"apps":[{"id":"dev-app-id","displayName":"Signals Dev · main","tags":["signals","dev","slot-main"]}]}}',
);
assert.equal(appsFromCliPayload(cliPayload)[0].id, "dev-app-id");

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

// A marketplace install runs the canonical app from <storage>/marketplace-deploy/signals-<version> (#535).
assert.equal(marketplaceDeployRoot("/storage/realtimex.db"), "/storage/marketplace-deploy");
for (const [workingDir, expected] of [
  ["/repo/signals", true],
  ["/repo/signals/", true],
  ["/storage/marketplace-deploy/signals-0.2.20", true],
  ["/storage/marketplace-deploy/signals-0.2.21-dev.3", true],
  ["/storage/marketplace-deploy/signals-0.2.20/src", false],
  ["/storage/marketplace-deploy/other-app-1.0.0", false],
  ["/storage/marketplace-deploy/signals-latest", false],
  ["/elsewhere/marketplace-deploy/signals-0.2.20", false],
  ["/repo/signals-worktrees/issue-534", false],
  ["marketplace-deploy/signals-0.2.20", false],
  ["", false],
]) {
  assert.equal(
    isCanonicalWorkingDir(workingDir, "/repo/signals", "/storage/marketplace-deploy"),
    expected,
    workingDir,
  );
}
const marketplaceCanonical = {
  ...cleanCanonical,
  config: JSON.stringify({
    command: "/node/bin/node",
    args: ["server.js"],
    working_dir: "/storage/marketplace-deploy/signals-0.2.20",
    env: { SIGNALS_DATA_DIR: "~/.signals" },
  }),
};
assert.deepEqual(
  canonicalConfigProblems(marketplaceCanonical, "/repo/signals", undefined, {
    marketplaceDeployRoot: "/storage/marketplace-deploy",
  }),
  [],
);
// Without a deploy root (no --db context) only the checkout is canonical.
assert.deepEqual(canonicalConfigProblems(marketplaceCanonical, "/repo/signals"), [
  "canonical working_dir is not /repo/signals",
]);
// The other guards still apply to a marketplace deploy.
assert.deepEqual(
  canonicalConfigProblems(
    {
      ...cleanCanonical,
      config: JSON.stringify({
        command: "/node/bin/node",
        args: ["server.js"],
        working_dir: "/storage/marketplace-deploy/signals-0.2.20",
        env: { SIGNALS_DATA_DIR: "/private/tmp/signals-qa-issue-535-data" },
      }),
    },
    "/repo/signals",
    undefined,
    { marketplaceDeployRoot: "/storage/marketplace-deploy" },
  ),
  ["canonical SIGNALS_DATA_DIR is not ~/.signals"],
);

for (const script of ["verify-signals-local-app-hygiene.mjs", "migrate-dev-signals-row.mjs", "qa-local-app.mjs"]) {
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
assert.match(recoveryWithoutGuard.stderr, /qa-local-app\.mjs/);

const launcherPackage = JSON.parse(
  readFileSync(join(scriptDir, "signals-dev-local-app-launcher", "package.json"), "utf8"),
);
assert.equal(launcherPackage.scripts.start, "node launcher.mjs");
assert.match(
  readFileSync(join(scriptDir, "signals-dev-local-app-launcher", "launcher.mjs"), "utf8"),
  /SIGNALS_DEV_WORKTREE/,
);
const repoPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
assert.equal(repoPackage.name, "@realtimex/signals");

// ---- Slot model (#541) ------------------------------------------------------------------------
const home = homedir();
const slotRoot = realpathSync(mkdtempSync(join(tmpdir(), "signals-dev-slot-test-")));
const savedSlotEnv = {
  SIGNALS_DEV_ROOT: process.env.SIGNALS_DEV_ROOT,
  SIGNALS_CANONICAL_DATA_DIR: process.env.SIGNALS_CANONICAL_DATA_DIR,
};
try {
  const devRoot = join(slotRoot, "signals-dev");
  const realData = join(slotRoot, "real-signals");
  process.env.SIGNALS_DEV_ROOT = devRoot;
  process.env.SIGNALS_CANONICAL_DATA_DIR = realData;

  // Real data in every spelling; nothing else.
  for (const [value, expected] of [
    ["~/.signals", true],
    ["~/.signals/", true],
    [join(home, ".signals"), true],
    [`${join(home, ".signals")}/`, true],
    [realData, true],
    [join(home, ".signals-dev", "main"), false],
    [join(devRoot, "main"), false],
    ["/private/tmp/signals-qa-issue-1-data", false],
    [".signals", false],
    ["", false],
    [undefined, false],
  ]) {
    assert.equal(pointsAtRealSignalsData(value), expected, String(value));
  }
  // The Dev root may never sit inside the real data.
  process.env.SIGNALS_DEV_ROOT = join(realData, "nested");
  assert.throws(() => signalsDevRoot(), /inside the real Signals data/);
  process.env.SIGNALS_DEV_ROOT = devRoot;
  assert.equal(signalsDevRoot(), devRoot);

  assert.equal(sanitizeSlot("Loop_Issue 541--F909"), "loop-issue-541-f909");
  assert.equal(sanitizeSlot("--a..b--"), "a-b");
  assert.equal(baseSlotFor({ primary: true, path: "/x/signals" }), "main");
  assert.equal(baseSlotFor({ primary: false, path: "/x/worktrees/loop-issue-541-f90967d6" }), "loop-issue-541-f90967d6");
  assert.match(baseSlotFor({ primary: false, path: "/x/___" }), /^wt-[0-9a-f]{6}$/);
  assert.equal(devAppDisplayName("main"), "Signals Dev · main");
  const tags = devAppTags({ slot: "s1", worktree: "/x/wt", issueId: "541", loopId: "loop-issue-541-f9" });
  assert.deepEqual(tags, ["signals", "dev", "slot-s1", `worktree-${worktreeHash("/x/wt").slice(0, 8)}`, "issue-541", "loop-issue-541-f9"]);
  assert.deepEqual(devAppTags({ slot: "s1", worktree: "/x/wt", loopId: "abc" }).slice(-1), ["loop-abc"]);

  // Env pins: dev instance, scheduler off, slot data, own workspace, Dev host only.
  const env = devAppEnv({ slot: "s1", worktree: "/x/wt", port: 3333, dataDir: join(devRoot, "s1"), nodeBinDir: "/node/bin", path: "/usr/bin" });
  assert.deepEqual(env, {
    SIGNALS_INSTANCE: "dev",
    SIGNALS_SCHEDULER_ENABLED: "0",
    SIGNALS_DATA_DIR: join(devRoot, "s1"),
    SIGNALS_RTX_WORKSPACE_SLUG: "signals-dev-s1",
    SIGNALS_DEV_WORKTREE: "/x/wt",
    PORT: "3333",
    HOSTNAME: "127.0.0.1",
    REALTIMEX_BASE_URL: "http://127.0.0.1:3101/cli",
    PATH: "/node/bin:/usr/bin",
  });
  const createArgs = buildDevCreateCliArgs({ slot: "s1", worktree: "/x/wt", port: 3333, dataDir: join(devRoot, "s1"), tags });
  assert.equal(createArgs[0], "create-local-app");
  assert.equal(createArgs[createArgs.indexOf("--display-name") + 1], "Signals Dev · s1");
  assert.equal(createArgs[createArgs.indexOf("--home-url") + 1], "http://localhost:3333/dashboard");
  assert.match(createArgs[createArgs.indexOf("--source-path") + 1], /signals-dev-local-app-launcher$/);
  assert.equal(JSON.parse(createArgs[createArgs.indexOf("--env") + 1]).PORT, "3333");

  // Ports: every pin a row can carry, and the deterministic walk past taken/reserved/listening.
  const row = (config, extra = {}) => ({ id: "r", display_name: "R", config: JSON.stringify(config), ...extra });
  assert.deepEqual(pinnedPorts(row({ args: ["run", "dev", "-p", "3401"] })), [3401]);
  assert.deepEqual(pinnedPorts(row({ args: ["--port=3402"] })), [3402]);
  assert.deepEqual(pinnedPorts(row({ port: 3403, env: { PORT: "3404" }, home_url: "http://localhost:3405/dashboard" })).sort(), [3403, 3404, 3405]);
  assert.deepEqual(pinnedPorts(row({ home_url: "http://localhost:{port}/dashboard" })), []);
  const candidate = PORT_RANGE_START + (Number.parseInt(worktreeHash("/x/wt").slice(0, 8), 16) % PORT_RANGE_SIZE);
  assert.equal(RESERVED_PORTS.some((port) => port >= PORT_RANGE_START && port < PORT_RANGE_START + PORT_RANGE_SIZE), false);
  assert.equal(choosePort("/x/wt"), candidate);
  const next = choosePort("/x/wt", { taken: new Set([candidate]) });
  assert.notEqual(next, candidate);
  assert.ok(next >= PORT_RANGE_START && next < PORT_RANGE_START + PORT_RANGE_SIZE);
  assert.notEqual(choosePort("/x/wt", { listening: (port) => port === candidate }), candidate);
  assert.equal(choosePort("/x/wt", { listening: () => true }), null);

  // Dev-host invariant: real data in any spelling, or a 3010 pin in any field.
  assert.deepEqual(devHostProblems([row({ env: { SIGNALS_DATA_DIR: join(devRoot, "main"), PORT: "3333" } })]), []);
  assert.equal(devHostProblems([row({ env: { SIGNALS_DATA_DIR: "~/.signals" } })]).length, 1);
  assert.equal(devHostProblems([row({ env: { SIGNALS_DATA_DIR: join(home, ".signals") } })]).length, 1);
  assert.equal(devHostProblems([row({ home_url: "http://localhost:3010/dashboard" })]).length, 1);
  assert.equal(devHostProblems([row({ env: { SIGNALS_DATA_DIR: "~/.signals", PORT: "3010" } })]).length, 2);
  assert.equal(legacyQaIssueId({ display_name: "Signals issue-159 QA" }), "159");
  assert.equal(legacyQaIssueId({ display_name: "Signals Dev · main" }), null);

  // The receipt-backed app is touched only with every slot tag.
  const receipt = { displayName: "Signals Dev · s1", tags };
  assert.deepEqual(slotAppProblems({ id: "a", displayName: "Signals Dev · s1", tags }, receipt), []);
  assert.match(slotAppProblems({ id: "a", displayName: "Signals Dev · s1", tags: tags.slice(1) }, receipt).join(), /safety tag signals/);
  assert.match(slotAppProblems({ id: CANONICAL_SIGNALS_APP_ID, displayName: "Signals Dev · s1", tags }, receipt).join(), /canonical/);
  // Issue and loop tags are labels, not safety tags.
  assert.deepEqual(slotAppProblems({ id: "a", displayName: "Signals Dev · s1", tags: tags.slice(0, 4) }, receipt), []);

  // Installed-app diff: apps added/removed/changed fail; the canonical row and new workspaces warn.
  const before = packagedHostFingerprint(
    [
      { id: CANONICAL_SIGNALS_APP_ID, display_name: "Signals", config: "{\"v\":1}" },
      { id: "other", display_name: "Other", config: "{}" },
    ],
    [{ slug: "signals" }],
  );
  const same = diffPackagedHost(before, before);
  assert.equal(same.unchanged, true);
  const canonicalUpdated = diffPackagedHost(
    before,
    packagedHostFingerprint(
      [
        { id: CANONICAL_SIGNALS_APP_ID, display_name: "Signals", config: "{\"v\":2}" },
        { id: "other", display_name: "Other", config: "{}" },
      ],
      [{ slug: "signals" }, { slug: "signals-dev-s1" }, { slug: "marketing" }],
    ),
  );
  assert.equal(canonicalUpdated.unchanged, true);
  assert.equal(canonicalUpdated.warnings.length, 2);
  const polluted = diffPackagedHost(
    before,
    packagedHostFingerprint(
      [
        { id: CANONICAL_SIGNALS_APP_ID, display_name: "Signals", config: "{\"v\":1}" },
        { id: "other", display_name: "Other", config: "{\"changed\":true}" },
        { id: "new", display_name: "Signals Dev · s1", config: "{}" },
      ],
      [{ slug: "signals" }],
    ),
  );
  assert.equal(polluted.unchanged, false);
  assert.deepEqual(polluted.added.map((entry) => entry.id), ["new"]);
  assert.deepEqual(polluted.changed.map((entry) => entry.id), ["other"]);

  // Checkouts: primary and linked, refuse non-Signals and subdirectories.
  const repo = join(slotRoot, "repo");
  const linked = join(slotRoot, "worktrees", "loop-issue-9-abc");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "qa-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Signals QA Test"], { cwd: repo });
  writeFileSync(join(repo, "package.json"), '{ "name": "@realtimex/signals", "private": true }\n');
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "keep"), "");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", "-b", "issue-9", linked], { cwd: repo, stdio: "ignore" });
  assert.deepEqual(resolveSignalsCheckout(repo), { path: repo, primary: true, branch: "main" });
  assert.deepEqual(resolveSignalsCheckout(linked), { path: linked, primary: false, branch: "issue-9" });
  assert.equal(canonicalSignalsRepoRoot(linked), repo);
  assert.throws(() => resolveSignalsCheckout(join(repo, "src")), /no package\.json/);
  writeFileSync(join(repo, "src", "package.json"), '{ "name": "@realtimex/signals" }\n');
  assert.throws(() => resolveSignalsCheckout(join(repo, "src")), /pass the checkout root/);
  const foreign = join(slotRoot, "foreign");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "package.json"), '{ "name": "other" }\n');
  assert.throws(() => resolveSignalsCheckout(foreign), /Expected @realtimex\/signals/);

  // A slot held by another checkout's receipt sends this one to the hashed variant.
  const linkedCheckout = resolveSignalsCheckout(linked);
  assert.equal(resolveSlot(linkedCheckout), "loop-issue-9-abc");
  const held = slotPaths("loop-issue-9-abc");
  mkdirSync(held.launcherDir, { recursive: true });
  writeFileSync(held.receiptPath, JSON.stringify({ worktree: "/elsewhere/loop-issue-9-abc", dataDir: held.dataDir }));
  assert.equal(resolveSlot(linkedCheckout), `loop-issue-9-abc-${worktreeHash(linked).slice(0, 6)}`);
  writeFileSync(held.receiptPath, JSON.stringify({ worktree: linked, dataDir: held.dataDir }));
  assert.equal(resolveSlot(linkedCheckout), "loop-issue-9-abc");
  assert.equal(slotReceiptForWorktree(linked).dataDir, held.dataDir);
  assert.equal(slotReceiptForWorktree(repo), null);

  // Snapshot profile: online backup of data.db + media only, credentials scrubbed, real data intact.
  if (spawnSync("sqlite3", ["-version"]).status === 0) {
    mkdirSync(join(realData, "media"), { recursive: true });
    mkdirSync(join(realData, "browser-profiles"), { recursive: true });
    writeFileSync(join(realData, "media", "avatar.png"), "png");
    writeFileSync(join(realData, "browser-profiles", "cookies"), "secret");
    writeFileSync(join(realData, "config.json"), "{}");
    execFileSync("sqlite3", [
      join(realData, "data.db"),
      "pragma journal_mode = wal; create table platform_accounts (id integer primary key, credentials_encrypted text, status text); " +
        "insert into platform_accounts values (1, 'cipher', 'active'); create table scheduled_jobs (id integer primary key, status text); " +
        "insert into scheduled_jobs values (1, 'pending');",
    ]);
    const realBefore = readFileSync(join(realData, "data.db"));
    const slotData = join(devRoot, "snap");
    const snapshot = prepareSlotData({ dataDir: slotData, profile: "snapshot" });
    assert.deepEqual(snapshot.copied, ["data.db", "media"]);
    assert.equal(execFileSync("sqlite3", [join(slotData, "data.db"), "select coalesce(credentials_encrypted, 'NULL') || '|' || status from platform_accounts;"], { encoding: "utf8" }).trim(), "NULL|needs_reauth");
    assert.equal(execFileSync("sqlite3", [join(slotData, "data.db"), "select status from scheduled_jobs;"], { encoding: "utf8" }).trim(), "pending");
    assert.equal(existsSync(join(slotData, "media", "avatar.png")), true);
    assert.equal(existsSync(join(slotData, "browser-profiles")), false);
    assert.equal(existsSync(join(slotData, "config.json")), false);
    assert.equal(existsSync(join(slotData, "data.db.partial")), false);
    // The source is WAL; the copy must be one self-contained file with no orphaned sidecars.
    for (const sidecar of ["data.db.partial-wal", "data.db.partial-shm", "data.db-wal", "data.db-shm"]) {
      assert.equal(existsSync(join(slotData, sidecar)), false, sidecar);
    }
    assert.equal(execFileSync("sqlite3", [join(slotData, "data.db"), "pragma journal_mode;"], { encoding: "utf8" }).trim(), "delete");
    assert.equal(execFileSync("sqlite3", [join(realData, "data.db"), "select credentials_encrypted from platform_accounts;"], { encoding: "utf8" }).trim(), "cipher");
    assert.deepEqual(readFileSync(join(realData, "data.db")), realBefore);
    assert.throws(() => prepareSlotData({ dataDir: slotData, profile: "snapshot" }), (error) => error.errorCode === "SLOT_DATA_EXISTS");
    assert.throws(() => prepareSlotData({ dataDir: realData, profile: "empty" }), /real Signals data/);
    assert.throws(() => prepareSlotData({ dataDir: join(realData, "media"), profile: "snapshot" }), /real Signals data/);
    const empty = prepareSlotData({ dataDir: join(devRoot, "empty"), profile: "empty" });
    assert.deepEqual(empty.copied, []);
    assert.equal(existsSync(join(devRoot, "empty")), true);
  }
} finally {
  for (const [key, value] of Object.entries(savedSlotEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(slotRoot, { recursive: true, force: true });
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
    const verify = (...args) =>
      spawnSync(process.execPath, [join(scriptDir, "verify-signals-local-app-hygiene.mjs"), ...args], {
        encoding: "utf8",
      });
    const packagedArgs = ["--packaged-db", verifierDb, "--canonical-repo", "/repo/signals"];
    assert.equal(verify().status, 2);
    const cleanResult = verify(...packagedArgs, "--issue", verifierIssue);
    assert.equal(cleanResult.status, 0, cleanResult.stderr);

    execFileSync("sqlite3", [
      verifierDb,
      `INSERT INTO local_apps VALUES (
        'qa-leftover', 'Renamed disposable app', 'signals-issue-${verifierIssue}-qa',
        '{}', '["qa","issue-${verifierIssue}"]', 'stopped'
      );`,
    ]);
    const dirtyResult = verify("--issue", verifierIssue, "--db", verifierDb);
    assert.equal(dirtyResult.status, 1);
    assert.match(dirtyResult.stderr, /issue-specific QA Local App record/);

    const setCanonicalWorkingDir = (workingDir) => {
      const config = JSON.stringify({
        command: "/node/bin/node",
        args: ["server.js"],
        working_dir: workingDir,
        env: { SIGNALS_DATA_DIR: "~/.signals" },
      }).replaceAll("'", "''");
      execFileSync("sqlite3", [
        verifierDb,
        `DELETE FROM local_apps WHERE id = 'qa-leftover';
         UPDATE local_apps SET config = '${config}' WHERE id = '${CANONICAL_SIGNALS_APP_ID}';`,
      ]);
    };
    setCanonicalWorkingDir(join(verifierRoot, "marketplace-deploy", "signals-0.2.20"));
    const marketplaceResult = verify(...packagedArgs);
    assert.equal(marketplaceResult.status, 0, marketplaceResult.stderr);
    assert.deepEqual(JSON.parse(marketplaceResult.stdout).packagedHost.canonicalProblems, []);

    setCanonicalWorkingDir(join(tmpdir(), "elsewhere", "marketplace-deploy", "signals-0.2.20"));
    const foreignResult = verify(...packagedArgs);
    assert.equal(foreignResult.status, 1);
    assert.match(foreignResult.stderr, /neither \/repo\/signals nor a Signals marketplace deploy/);
    setCanonicalWorkingDir(join(verifierRoot, "marketplace-deploy", "signals-0.2.20"));

    // A snapshot from up: an app added since then fails; the canonical row's own update does not.
    const snapshotPath = join(verifierRoot, "session.json");
    const fingerprintRows = JSON.parse(
      execFileSync("sqlite3", ["-json", verifierDb, "select id, display_name, config from local_apps;"], { encoding: "utf8" }),
    );
    writeFileSync(snapshotPath, JSON.stringify({ packaged: packagedHostFingerprint(fingerprintRows, []) }));
    assert.equal(verify(...packagedArgs, "--snapshot", snapshotPath).status, 0);
    setCanonicalWorkingDir(join(verifierRoot, "marketplace-deploy", "signals-0.2.22"));
    const updated = verify(...packagedArgs, "--snapshot", snapshotPath);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(JSON.parse(updated.stdout).warnings.join(), /canonical Signals record changed/);
    execFileSync("sqlite3", [
      verifierDb,
      "INSERT INTO local_apps VALUES ('stray', 'Signals Dev · stray', 'signals-dev-stray', '{}', '[]', 'stopped');",
    ]);
    const polluted = verify(...packagedArgs, "--snapshot", snapshotPath);
    assert.equal(polluted.status, 1);
    assert.match(polluted.stderr, /gained Local App Signals Dev · stray/);

    // Dev-host invariant: the legacy Dev "Signals" row (real data, 3010) fails until migrated.
    const devDb = join(verifierRoot, "dev.db");
    execFileSync("sqlite3", [
      devDb,
      `CREATE TABLE local_apps (id TEXT PRIMARY KEY, display_name TEXT, config TEXT);
       INSERT INTO local_apps VALUES ('legacy', 'Signals', '${JSON.stringify({ port: 3010, env: { SIGNALS_DATA_DIR: "~/.signals", PORT: "3010" } })}');
       INSERT INTO local_apps VALUES ('safe', 'Signals Dev · main', '${JSON.stringify({ env: { SIGNALS_DATA_DIR: join(verifierRoot, "signals-dev", "main"), PORT: "3333" } })}');`,
    ]);
    const unsafe = verify("--dev-db", devDb);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /Signals \(legacy\) sets SIGNALS_DATA_DIR to the real Signals data/);
    assert.match(unsafe.stderr, /pins port 3010/);
    execFileSync("sqlite3", [devDb, "DELETE FROM local_apps WHERE id = 'legacy';"]);
    assert.equal(verify("--dev-db", devDb).status, 0);
  } finally {
    rmSync(verifierRoot, { recursive: true, force: true });
  }
}

console.log("OK: Signals QA Local App isolation and teardown contracts verified");
