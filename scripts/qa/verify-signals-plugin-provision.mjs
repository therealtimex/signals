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
 */
import { spawnSync } from "node:child_process";

const DEFAULT_PLUGIN_ID = "79f6f094-a15f-4af0-8dbb-605552701218";
const WORKSPACE_SLUG = "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f";
const REQUIRED_SKILLS = ["realtimex-signals", "signals-publish"];

function parsePluginId() {
  const idx = process.argv.indexOf("--plugin-id");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_PLUGIN_ID;
}

function runPp(args) {
  const result = spawnSync("realtimex-pp-cli", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `realtimex-pp-cli ${args.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart === -1) throw new Error(`No JSON from pp-cli: ${result.stdout}`);
  return JSON.parse(result.stdout.slice(jsonStart));
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

const pluginId = parsePluginId();

console.log("Signals plugin provision QA");
console.log(`  plugin id: ${pluginId}`);
console.log(`  expected workspace slug: ${WORKSPACE_SLUG}`);
console.log("");

if (process.argv.includes("--deploy-instructions")) {
  console.log("Deploy (required once after install):");
  console.log("  1. Open RealtimeX → Settings → Plugins");
  console.log("  2. Select Signals (com.realtimex.signals)");
  console.log("  3. Click Deploy (not just Enable)");
  console.log("  4. Re-run: node scripts/qa/verify-signals-plugin-provision.mjs");
  process.exit(0);
}

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

console.log("");
console.log("Provision verification passed. QA can continue browser/publish checks.");
