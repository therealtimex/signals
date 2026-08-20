#!/usr/bin/env node
/**
 * Ensure marketplace release versions are aligned before packaging or publishing.
 *
 * Usage:
 *   node scripts/verify-marketplace-versions.mjs
 *   node scripts/verify-marketplace-versions.mjs --tag v0.1.10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNALS_NODE_VERSION } from "./node-runtime-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

const pkg = readJson("package.json");
const plugin = readJson("realtimex-plugin/realtimex.plugin.json");
const localApp = readJson("realtimex-plugin/marketplace/local-app.manifest.json");
const nvmNodeVersion = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();

const tagArg =
  process.argv.find((arg) => arg.startsWith("--tag="))?.slice("--tag=".length) ||
  process.env.GITHUB_REF_NAME ||
  "";

const errors = [];

if (plugin.version !== pkg.version) {
  errors.push(
    `realtimex.plugin.json version ${plugin.version} != package.json ${pkg.version}`
  );
}

if (nvmNodeVersion !== SIGNALS_NODE_VERSION) {
  errors.push(`.nvmrc version ${nvmNodeVersion} != ${SIGNALS_NODE_VERSION}`);
}
if (pkg.engines?.node !== SIGNALS_NODE_VERSION) {
  errors.push(
    `package.json engines.node ${pkg.engines?.node ?? "missing"} != ${SIGNALS_NODE_VERSION}`,
  );
}

if (pkg.private !== true || pkg.license !== "UNLICENSED") {
  errors.push("package.json must be private and UNLICENSED for proprietary distribution");
}
if (plugin.license !== "UNLICENSED") {
  errors.push("realtimex.plugin.json must be UNLICENSED");
}
if (
  localApp.runtime?.kind !== "node" ||
  localApp.runtime?.version !== SIGNALS_NODE_VERSION ||
  localApp.runtime?.managedBy !== "realtimex"
) {
  errors.push(
    `local-app.manifest.json must require RealtimeX-managed Node ${SIGNALS_NODE_VERSION}`,
  );
}
if (localApp.configuration?.command !== "{runtime.executable}") {
  errors.push("local-app.manifest.json must launch the managed runtime executable");
}
// Match the host packages published by realtimex-sdk exactly.
const requiredTargets = [
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
];
const supportedTargets = localApp.artifactContract?.supportedTargets ?? [];
const uniqueSupportedTargets = [...new Set(supportedTargets)];
const hasExactTargetSet =
  uniqueSupportedTargets.length === supportedTargets.length &&
  [...uniqueSupportedTargets].sort().join(",") ===
    [...requiredTargets].sort().join(",");
if (!hasExactTargetSet) {
  errors.push(
    `local-app.manifest.json supported targets must exactly match RealtimeX SDK targets (${requiredTargets.join(", ")}); received: ${supportedTargets.join(", ") || "none"}`
  );
}

if (tagArg.startsWith("v")) {
  const tagVersion = tagArg.slice(1);
  if (tagVersion !== pkg.version) {
    errors.push(
      `Git tag ${tagArg} version ${tagVersion} != package.json ${pkg.version}`
    );
  }
}

if (errors.length) {
  console.error("Marketplace version verification failed:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `OK marketplace versions aligned at ${pkg.version}${tagArg ? ` (tag ${tagArg})` : ""}`
);
