#!/usr/bin/env node
/**
 * Regression: provision verifier must bootstrap without ENOENT on repo paths.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/qa/verify-signals-plugin-provision.mjs");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "realtimex-plugin/realtimex.plugin.json"), "utf8"),
);
const heartbeat = fs.readFileSync(
  path.join(root, "realtimex-plugin/templates/signals/HEARTBEAT.md"),
  "utf8",
);

const result = spawnSync(process.execPath, [script, "--deploy-instructions"], {
  cwd: root,
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error("verify --deploy-instructions failed:", result.stdout, result.stderr);
  process.exit(1);
}

const out = `${result.stdout}\n${result.stderr}`;
if (!out.includes("Settings") || !out.includes("Deploy")) {
  console.error("deploy-instructions output missing expected guidance:", out);
  process.exit(1);
}

if (out.includes("ENOENT") || out.includes("package.json")) {
  console.error("deploy-instructions should not touch missing repo paths:", out);
  process.exit(1);
}

if (!/^tasks:\s*\[\s*\]\s*$/m.test(heartbeat)) {
  console.error("provisioned HEARTBEAT.md must contain a safe empty tasks starter");
  process.exit(1);
}

const signalsProvision = manifest.provisions?.workspaces?.find(
  (workspace) => workspace.key === "signals",
);
if (signalsProvision?.workingDirectory?.copyPolicy !== "copy-missing") {
  console.error("Signals workspace provision must use copy-missing");
  process.exit(1);
}
if (signalsProvision?.workingDirectory?.managedPaths?.includes("HEARTBEAT.md")) {
  console.error("HEARTBEAT.md must not be managed or overwrite user edits on redeploy");
  process.exit(1);
}

console.log("verify-signals-plugin-provision smoke: OK");
