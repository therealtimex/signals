#!/usr/bin/env node
/**
 * Decide whether the gated release job should publish a GitHub Release.
 *
 *   node scripts/ci/should-publish-marketplace-release.mjs --main
 *   node scripts/ci/should-publish-marketplace-release.mjs --tag=v0.1.10
 *
 * Prints "publish" or "skip" on stdout. Exits 1 on misconfiguration.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const pkgVersion = pkg.version;

function parseVersion(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  }).trim();
}

function releaseExists(version) {
  try {
    gh(["release", "view", `v${version}`, "--json", "tagName"]);
    return true;
  } catch {
    return false;
  }
}

function latestPublishedVersion() {
  const out = gh([
    "release",
    "list",
    "--limit",
    "20",
    "--json",
    "tagName,isDraft",
    "--jq",
    "[.[] | select(.isDraft == false) | .tagName][0] // \"\"",
  ]);
  if (!out) return null;
  return out.replace(/^v/, "");
}

const tagArg = process.argv.find((arg) => arg.startsWith("--tag="))?.slice("--tag=".length);
const mainPush = process.argv.includes("--main");

if (tagArg) {
  const tagVersion = tagArg.replace(/^v/, "");
  if (tagVersion !== pkgVersion) {
    console.error(
      `Git tag ${tagArg} version ${tagVersion} != package.json ${pkgVersion}`
    );
    process.exit(1);
  }
  if (releaseExists(pkgVersion)) {
    console.log("skip");
    process.exit(0);
  }
  console.log("publish");
  process.exit(0);
}

if (mainPush) {
  if (releaseExists(pkgVersion)) {
    console.log("skip");
    process.exit(0);
  }
  const latest = latestPublishedVersion();
  if (!latest) {
    console.log("publish");
    process.exit(0);
  }
  const cmp = compareSemver(pkgVersion, latest);
  if (cmp === null) {
    console.error(
      `Failed to compare package.json ${pkgVersion} with latest release ${latest}`
    );
    process.exit(1);
  }
  if (cmp > 0) {
    console.log("publish");
    process.exit(0);
  }
  console.log("skip");
  process.exit(0);
}

console.error(
  "Usage: should-publish-marketplace-release.mjs --main | --tag=vX.Y.Z"
);
process.exit(1);
