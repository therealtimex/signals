#!/usr/bin/env node
/**
 * Publish staged signals-pp-cli npm packages (platform binaries first, launcher last).
 *
 * Publishing is idempotent per package version. A release job can die after npm
 * has taken some or all of the packages — v0.2.8 lost its artifact upload to an
 * ECONNRESET *after* every package was live — and npm answers a republish of the
 * same version with a 403. Throwing on that made the whole pipeline
 * unresumable: the only way to get the GitHub Release out was another version
 * bump. So a version already on the registry is a satisfied postcondition, not
 * an error; anything else still fails the job.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "dist", "npm");
const ORDER_PATH = path.join(OUT_ROOT, "publish-order.json");

export function publishedVersionExists(packageName, version, runner = spawnSync) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = runner(npmCmd, ["view", `${packageName}@${version}`, "version"], {
    encoding: "utf8",
    shell: false,
  });
  // A missing package or a missing version both exit non-zero; only an exact
  // version echoed back counts as already published. Never treat a registry
  // outage as "already there" — that would silently skip a real publish.
  if (result.status !== 0) return false;
  return String(result.stdout || "").trim() === version;
}

function runNpmPublish(packageDir, distTag) {
  const printable = `npm publish --access public --tag ${distTag}`;
  console.log(`$ (cd ${packageDir}) ${printable}`);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["publish", "--access", "public", "--tag", distTag], {
    cwd: packageDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm publish failed in ${packageDir} (exit ${result.status})`);
  }
}

function packageDir(packageName) {
  if (packageName === "@realtimex/signals-pp-cli") {
    return path.join(OUT_ROOT, "@realtimex", "signals-pp-cli");
  }
  return path.join(OUT_ROOT, packageName);
}

function main() {
  if (!fs.existsSync(ORDER_PATH)) {
    throw new Error("Missing dist/npm/publish-order.json — run: npm run package:signals-pp-cli-npm");
  }
  const order = JSON.parse(fs.readFileSync(ORDER_PATH, "utf8"));
  const distTag = String(process.env.SIGNALS_PP_CLI_NPM_DIST_TAG || "latest").trim() || "latest";
  let published = 0;
  let skipped = 0;
  for (const packageName of order.packages || []) {
    const dir = packageDir(packageName);
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      throw new Error(`Missing staged package at ${dir}`);
    }
    if (publishedVersionExists(packageName, order.version)) {
      console.log(`[signals-pp-cli npm] ${packageName}@${order.version} is already published — skipping`);
      skipped += 1;
      continue;
    }
    runNpmPublish(dir, distTag);
    published += 1;
  }
  console.log(
    `[signals-pp-cli npm] ${published} published, ${skipped} already present @${order.version}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
