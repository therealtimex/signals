import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { qaReceiptPath } from "../../qa/signals-qa-local-app.mjs";
import {
  FORM_FACTORS,
  THEMES,
  evidenceFileName,
  hideDevOverlay,
  resolveCaptureOrigin,
  waitForVisualSettle,
} from "./capture-guide-assets.mjs";
import { buildManifest, createCheckpointLedger } from "./experience-contract.mjs";

export const EXPERIENCE_CONTRACT_FLOW_NAME = "run-experience-contract";

export function parseArgs(argv = [], env = process.env) {
  const args = {
    contractId: null,
    baseUrl: env.SIGNALS_BASE_URL || null,
    dataDir: env.SIGNALS_DATA_DIR || null,
    cdp: false,
    cdpUrl: env.RTX_DEV_CDP_URL || "http://127.0.0.1:9888",
    promoteEvidence: false,
    prefix: "after",
    json: false,
    quiet: false,
    help: false,
    outputDir: null,
  };
  const value = (index, raw) => {
    if (raw.includes("=")) return raw.split(/=(.*)/s)[1];
    if (index + 1 >= argv.length) throw new Error(`Missing value for ${raw}`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("-") && !args.contractId) {
      args.contractId = raw;
      continue;
    }
    const key = raw.includes("=") ? raw.split("=")[0] : raw;
    switch (key) {
      case "--contract":
        args.contractId = value(index, raw);
        if (!raw.includes("=")) index += 1;
        break;
      case "--base-url":
        args.baseUrl = value(index, raw);
        if (!raw.includes("=")) index += 1;
        break;
      case "--data-dir":
        args.dataDir = value(index, raw);
        if (!raw.includes("=")) index += 1;
        break;
      case "--output-dir":
        args.outputDir = value(index, raw);
        if (!raw.includes("=")) index += 1;
        break;
      case "--cdp":
        args.cdp = true;
        if (raw.includes("=")) args.cdpUrl = value(index, raw);
        break;
      case "--promote-evidence":
        args.promoteEvidence = true;
        break;
      case "--prefix":
        args.prefix = value(index, raw);
        if (!raw.includes("=")) index += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${raw}`);
    }
  }
  if (!args.help && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.contractId ?? "")) {
    throw new Error("A kebab-case contract id is required.");
  }
  if (!/^(before|after)$/.test(args.prefix)) throw new Error("--prefix must be before or after");
  return args;
}

export function createHelpText() {
  return [
    "Usage: npm run automation:contract -- <contract-id> [options]",
    "",
    "Run one executable Experience Contract and write its manifest.",
    "",
    "  --base-url <url>       Signals origin; otherwise resolve through the Dev app",
    "  --data-dir <path>      Disposable fixture data directory",
    "  --cdp[=<url>]          Reuse the Dev app browser page instead of launching Chromium",
    "  --output-dir <path>    Override the per-run evidence directory",
    "  --promote-evidence     Generate committed desktop/mobile light/dark stills",
    "  --prefix before|after  Promoted filename prefix (default: after)",
    "  --json                 Print the manifest JSON",
    "  --quiet                Suppress progress logs",
  ].join("\n");
}

export function contractPaths(repoDir, contractId) {
  const scenarioDir = join(repoDir, "scripts", "app-automation", "scenarios");
  return {
    contractPath: join(scenarioDir, `${contractId}.contract.mjs`),
    scenarioPath: join(scenarioDir, `${contractId}.mjs`),
    contractRepoPath: `scripts/app-automation/scenarios/${contractId}.contract.mjs`,
  };
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultOutputDir(repoDir, contractId, env = process.env) {
  const root = env.RTXTEST_ARTIFACTS_DIR
    ? join(env.RTXTEST_ARTIFACTS_DIR, "experience")
    : join(repoDir, ".evidence", "experience");
  return join(root, contractId, stamp());
}

export function resolveFixtureDataDir(issue, explicitDataDir) {
  if (explicitDataDir) return explicitDataDir;
  const receipt = qaReceiptPath(String(issue));
  if (!existsSync(receipt)) return null;
  try {
    return JSON.parse(readFileSync(receipt, "utf8")).dataDir ?? null;
  } catch {
    return null;
  }
}

function defaultGitState(repoDir) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, encoding: "utf8" }).trim().length > 0;
  return { sha, dirty };
}

function parseFixtureJson(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const line = trimmed.split("\n").reverse().find((candidate) => candidate.trim().startsWith("{"));
    if (!line) throw new Error("fixture did not emit JSON");
    return JSON.parse(line);
  }
}

export function fixtureProcessEnv(dataDir, env = process.env) {
  return {
    ...env,
    SIGNALS_DATA_DIR: dataDir,
    SIGNALS_SKIP_CLIENT_MIGRATIONS: "1",
  };
}

export function fixtureResultFromProcess(result) {
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  let payload = null;
  try {
    payload = parseFixtureJson(stdout);
  } catch (error) {
    if (result.status === 0) throw error;
  }
  if (result.status === 0 && payload) return payload;

  const detail = payload?.error
    ?? stderr.trim()
    ?? result.error?.message
    ?? `fixture process exited ${result.status ?? "without a status"}`;
  const error = new Error(detail);
  error.code = typeof payload?.code === "string" ? payload.code : "fixture_failed";
  if (Array.isArray(payload?.reasons)) error.reasons = payload.reasons.map(String);
  error.exitCode = result.status;
  throw error;
}

function defaultRunFixture({ repoDir, name, dataDir }) {
  if (!dataDir) {
    const error = new Error("fixture_precondition_unmet: pass --data-dir or provision the issue QA Local App");
    error.code = "fixture_precondition_unmet";
    throw error;
  }
  const result = spawnSync(
    "npm",
    ["run", "seed:fixture", "--", "--fixture", name, "--json"],
    {
      cwd: repoDir,
      encoding: "utf8",
      env: fixtureProcessEnv(dataDir),
    },
  );
  return fixtureResultFromProcess(result);
}

async function defaultCreateSession({ chromium, origin, cdp, cdpUrl }) {
  if (cdp) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    const page = context?.pages().find((candidate) => candidate.url().startsWith(origin)) ?? context?.pages()[0];
    if (!page) throw new Error("No page is available on the CDP connection");
    return { page, close: () => browser.close() };
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  return { page, close: () => browser.close() };
}

async function promoteCapture(page, repoDir, name, prefix) {
  const currentViewport = page.viewportSize();
  const files = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const formFactor of FORM_FACTORS) {
      await page.setViewportSize({ width: formFactor.width, height: formFactor.height });
      await waitForVisualSettle(page);
      const afterName = evidenceFileName(name, formFactor.label, theme);
      const fileName = prefix === "after" ? afterName : afterName.replace(/^after_/, `${prefix}_`);
      const path = join(repoDir, ".evidence", fileName);
      mkdirSync(dirname(path), { recursive: true });
      await page.screenshot({ path, fullPage: true });
      files.push(path);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  if (currentViewport) await page.setViewportSize(currentViewport);
  return files;
}

export async function runExperienceContract(args, dependencies = {}) {
  const repoDir = resolve(dependencies.repoDir ?? process.cwd());
  const paths = contractPaths(repoDir, args.contractId);
  const importModule = dependencies.importModule ?? ((path) => import(pathToFileURL(path).href));
  const contract = (await importModule(paths.contractPath)).default;
  const scenario = (await importModule(paths.scenarioPath)).default;
  const resolveOrigin = dependencies.resolveOrigin ?? resolveCaptureOrigin;
  const target = await resolveOrigin({ baseUrl: args.baseUrl });
  if (!target.ok || !target.origin) {
    return { exitCode: 3, manifest: null, target, manifestPath: null };
  }

  const outputDir = resolve(args.outputDir ?? defaultOutputDir(repoDir, contract.id, dependencies.env));
  mkdirSync(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const gitState = (dependencies.getGitState ?? defaultGitState)(repoDir);
  const ledger = createCheckpointLedger(contract);
  const runnerFailures = [];
  let fixture = null;
  let session = null;

  try {
    if (contract.fixture) {
      const dataDir = resolveFixtureDataDir(contract.issue, args.dataDir);
      fixture = await (dependencies.runFixture ?? defaultRunFixture)({
        repoDir,
        name: contract.fixture,
        dataDir,
      });
    }
    const chromium = dependencies.chromium ?? (await import("playwright")).chromium;
    session = await (dependencies.createSession ?? defaultCreateSession)({
      chromium,
      origin: target.origin,
      cdp: args.cdp,
      cdpUrl: args.cdpUrl,
    });

    const capture = async (name) => {
      await hideDevOverlay(session.page).catch(() => {});
      await waitForVisualSettle(session.page);
      const file = join(outputDir, `${name}.png`);
      await session.page.screenshot({ path: file, fullPage: true });
      ledger.capture(name, basename(file));
      if (args.promoteEvidence) await promoteCapture(session.page, repoDir, name, args.prefix);
      return file;
    };
    const api = async (path, init) => {
      const response = await fetch(`${target.origin}${path}`, init);
      const body = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body };
    };
    await scenario({
      origin: target.origin,
      page: session.page,
      api,
      record: ledger.record,
      capture,
      fixture,
      log: dependencies.log ?? (() => {}),
    });
  } catch (error) {
    runnerFailures.push({
      code: error?.code ?? "scenario_failed",
      detail: error instanceof Error ? error.message : String(error),
      ...(Array.isArray(error?.reasons) ? { reasons: error.reasons.map(String) } : {}),
    });
  } finally {
    await session?.close?.();
  }

  const finalized = ledger.finalize();
  const manifest = buildManifest({
    contract,
    contractPath: paths.contractRepoPath,
    commit: gitState,
    target: { origin: target.origin, source: target.source, healthApp: target.healthApp ?? "signals" },
    fixture,
    startedAt,
    finishedAt: new Date().toISOString(),
    ledger: finalized,
    runnerFailures,
  });
  const manifestPath = join(outputDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const exitCode = manifest.result === "passed" ? 0 : manifest.result === "blocked" ? 2 : runnerFailures.some((f) => f.code === "fixture_precondition_unmet") ? 3 : 1;
  return { exitCode, manifest, manifestPath, target };
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    process.stdout.write(`${createHelpText()}\n`);
    return;
  }
  const result = await runExperienceContract(args, {
    log: args.quiet ? () => {} : (message) => process.stderr.write(`${message}\n`),
  });
  if (args.json && result.manifest) process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
  if (result.manifestPath && !args.quiet) process.stderr.write(`manifest: ${result.manifestPath}\n`);
  if (!result.manifest && result.target?.message) process.stderr.write(`${result.target.message}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
