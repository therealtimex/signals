#!/usr/bin/env node
/**
 * QA helper: verify (or guide deploy of) the Signals workspace-provision plugin.
 *
 * Install + enable the plugin first. Deploy is not exposed on realtimex-pp-cli;
 * use Settings → Plugins → Signals → Deploy, then run:
 *
 *   node scripts/qa/verify-signals-plugin-provision.mjs
 *
 * Optional: pass --plugin-id <uuid> (default: installed "signals" plugin).
 *
 * Requires STORAGE_DIR when verifying deployed skill files on disk.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const DEFAULT_PLUGIN_ID = "79f6f094-a15f-4af0-8dbb-605552701218";
const WORKSPACE_SLUG = "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f";
const REQUIRED_SKILLS = ["realtimex-signals", "signals-publish"];
const SOURCE_PUBLISH = path.join(
  repoRoot,
  ".claude/skills/signals-publish/scripts/x-publish.cjs"
);

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parsePluginId() {
  const idx = process.argv.indexOf("--plugin-id");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_PLUGIN_ID;
}

function runPp(args) {
  const withAgent = args.includes("--agent") ? args : [...args, "--agent"];
  const result = spawnSync("realtimex-pp-cli", withAgent, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `realtimex-pp-cli ${withAgent.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart === -1) throw new Error(`No JSON from pp-cli: ${result.stdout}`);
  return JSON.parse(result.stdout.slice(jsonStart));
}

function resolveStorageDir() {
  const storageDir = process.env.STORAGE_DIR?.trim();
  if (storageDir) return storageDir;
  throw new Error(
    "STORAGE_DIR is required to verify deployed signals-publish files on disk. " +
      "Set STORAGE_DIR to the RealtimeX storage root (the directory that contains working-data/)."
  );
}

function listWorkspaces() {
  const data = runPp(["list-workspaces", "--json", "--data-source", "live"]);
  return data.results?.workspaces ?? data.workspaces ?? [];
}

function listWorkspaceSkills(slug) {
  const data = runPp([
    "list-workspace-agent-skills",
    slug,
    "--json",
    "--data-source",
    "live",
  ]);
  return data.results?.skills ?? data.skills ?? [];
}

function deployedPublishCandidates(storageDir) {
  const bases = [
    path.join(storageDir, "working-data", WORKSPACE_SLUG),
    path.join(storageDir, "working-data", "signals"),
  ];
  const rels = [
    ".claude/skills/signals-publish/scripts/x-publish.cjs",
    ".agents/skills/signals-publish/scripts/x-publish.cjs",
    "skills/signals-publish/scripts/x-publish.cjs",
  ];
  const out = [];
  for (const base of bases) {
    for (const rel of rels) {
      out.push(path.join(base, rel));
    }
  }
  return out;
}

if (process.argv.includes("--deploy-instructions")) {
  console.log("Deploy (required once after install):");
  console.log("  1. Open RealtimeX → Settings → Plugins");
  console.log("  2. Select Signals (com.realtimex.signals)");
  console.log("  3. Click Deploy (not just Enable)");
  console.log("  4. Rebuild/reinstall plugin zip if you changed source since last install");
  console.log("  5. Re-run: node scripts/qa/verify-signals-plugin-provision.mjs");
  process.exit(0);
}

const pluginId = parsePluginId();
const expectedVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
).version;
const expectedPublishSha = fs.existsSync(SOURCE_PUBLISH)
  ? sha256File(SOURCE_PUBLISH)
  : null;

console.log("Signals plugin provision QA");
console.log(`  plugin id: ${pluginId}`);
console.log(`  expected workspace slug: ${WORKSPACE_SLUG}`);
console.log(`  expected plugin version: ${expectedVersion}`);
if (expectedPublishSha) {
  console.log(`  expected x-publish sha256: ${expectedPublishSha}`);
}
console.log("");

const pluginData = runPp(["get-plugin", pluginId, "--json", "--data-source", "live"]);
const plugin = pluginData.results?.plugin ?? pluginData.plugin;

if (!plugin) {
  console.error("BLOCKED: plugin not found for id", pluginId);
  process.exit(4);
}

if (plugin.id !== pluginId) {
  console.error(`BLOCKED: get-plugin returned id ${plugin.id}, expected ${pluginId}`);
  process.exit(4);
}

if (plugin.version !== expectedVersion) {
  console.error(
    `BLOCKED: installed plugin version ${plugin.version} != repo package.json ${expectedVersion}`
  );
  console.error("Rebuild dist/com.realtimex.signals-plugin.zip and reinstall/update before Deploy.");
  process.exit(4);
}

console.log(`OK installed plugin: ${plugin.displayName} v${plugin.version}`);

const workspaces = listWorkspaces();
const workspace = workspaces.find((w) => w.slug === WORKSPACE_SLUG);

if (!workspace) {
  console.error("BLOCKED: Signals provision workspace not found.");
  console.error(`Expected slug ${WORKSPACE_SLUG} in list-workspaces.`);
  console.error("");
  console.error("Run: node scripts/qa/verify-signals-plugin-provision.mjs --deploy-instructions");
  process.exit(2);
}

console.log(`OK workspace: ${workspace.name} (${workspace.slug})`);

const skills = listWorkspaceSkills(WORKSPACE_SLUG);
const names = new Set(skills.map((s) => s.name));
const missing = REQUIRED_SKILLS.filter((name) => !names.has(name));

if (missing.length) {
  console.error("BLOCKED: missing workspace skills:", missing.join(", "));
  console.error("Redeploy the plugin from Settings → Plugins → Signals → Deploy.");
  process.exit(3);
}

for (const name of REQUIRED_SKILLS) {
  const skill = skills.find((s) => s.name === name);
  console.log(
    `OK skill: ${name} (enabled=${skill?.enabled ?? skill?.isEnabled ?? "unknown"})`
  );
}

if (expectedPublishSha) {
  let storageDir;
  try {
    storageDir = resolveStorageDir();
  } catch (err) {
    console.error(`BLOCKED: ${err.message}`);
    process.exit(5);
  }
  let deployedPath = null;
  let deployedHash = null;
  for (const candidate of deployedPublishCandidates(storageDir)) {
    if (fs.existsSync(candidate)) {
      deployedPath = candidate;
      deployedHash = sha256File(candidate);
      break;
    }
  }
  if (!deployedPath) {
    console.error("BLOCKED: deployed signals-publish x-publish.cjs not found on disk.");
    console.error("Redeploy plugin workspace provision after reinstalling current zip.");
    process.exit(5);
  }
  if (deployedHash !== expectedPublishSha) {
    console.error("BLOCKED: deployed x-publish.cjs is stale vs repo source.");
    console.error(`  deployed: ${deployedPath}`);
    console.error(`  deployed sha256: ${deployedHash}`);
    console.error(`  expected sha256: ${expectedPublishSha}`);
    console.error("Reinstall current plugin zip with --force, then Settings → Plugins → Signals → Deploy.");
    process.exit(5);
  }
  console.log(`OK deployed x-publish.cjs matches repo (${deployedPath})`);
}

console.log("");
console.log("Provision verification passed. QA can continue browser/publish checks.");
