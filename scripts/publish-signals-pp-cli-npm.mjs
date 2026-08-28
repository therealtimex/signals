#!/usr/bin/env node
/**
 * Publish staged signals-pp-cli npm packages (platform binaries first, launcher last).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "dist", "npm");
const ORDER_PATH = path.join(OUT_ROOT, "publish-order.json");

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
  for (const packageName of order.packages || []) {
    const dir = packageDir(packageName);
    if (!fs.existsSync(path.join(dir, "package.json"))) {
      throw new Error(`Missing staged package at ${dir}`);
    }
    runNpmPublish(dir, distTag);
  }
  console.log(`[signals-pp-cli npm] published ${order.packages.length} package(s) @${order.version}`);
}

main();
