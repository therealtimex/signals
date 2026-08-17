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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

const pkg = readJson("package.json");
const plugin = readJson("realtimex-plugin/realtimex.plugin.json");

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
