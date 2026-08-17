#!/usr/bin/env node
/**
 * Regression: provision verifier must bootstrap without ENOENT on repo paths.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/qa/verify-signals-plugin-provision.mjs");

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

console.log("verify-signals-plugin-provision smoke: OK");
