#!/usr/bin/env node
/**
 * Verify staged npm packages for @realtimex/signals-pp-cli.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "dist", "npm");
const ORDER_PATH = path.join(OUT_ROOT, "publish-order.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packageDir(packageName) {
  if (packageName === "@realtimex/signals-pp-cli") {
    return path.join(OUT_ROOT, "@realtimex", "signals-pp-cli");
  }
  return path.join(OUT_ROOT, packageName);
}

function main() {
  if (!fs.existsSync(ORDER_PATH)) {
    console.log("skip: dist/npm/publish-order.json missing (run package:signals-pp-cli-npm)");
    process.exit(0);
  }

  const order = readJson(ORDER_PATH);
  const appVersion = readJson(path.join(ROOT, "package.json")).version;
  if (order.version !== appVersion) {
    console.error(`version mismatch: staged ${order.version} vs app ${appVersion}`);
    process.exit(1);
  }

  const mainDir = packageDir("@realtimex/signals-pp-cli");
  const mainPkg = readJson(path.join(mainDir, "package.json"));
  if (mainPkg.name !== "@realtimex/signals-pp-cli") {
    console.error("unexpected main package name");
    process.exit(1);
  }
  if (!mainPkg.optionalDependencies || Object.keys(mainPkg.optionalDependencies).length === 0) {
    console.error("main package missing optionalDependencies");
    process.exit(1);
  }

  for (const packageName of order.packages) {
    const dir = packageDir(packageName);
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      console.error(`missing staged package: ${packageName}`);
      process.exit(1);
    }
    const pkg = readJson(pkgPath);
    if (pkg.version !== appVersion) {
      console.error(`${packageName} version ${pkg.version} != app ${appVersion}`);
      process.exit(1);
    }
  }

  const platform = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch;
  const platformPackage = `@realtimex/signals-pp-cli-${platform}-${arch}`;
  const platformDir = packageDir(platformPackage);
  if (!fs.existsSync(platformDir)) {
    console.log(`skip launcher exec: no staged package for ${platformPackage}`);
    process.exit(0);
  }

  const installRoot = path.join(OUT_ROOT, ".test-install");
  fs.rmSync(installRoot, { recursive: true, force: true });
  const nm = path.join(installRoot, "node_modules", "@realtimex");
  fs.mkdirSync(nm, { recursive: true });
  fs.cpSync(platformDir, path.join(nm, platformPackage.replace("@realtimex/", "")), { recursive: true });
  fs.cpSync(mainDir, path.join(nm, "signals-pp-cli"), { recursive: true });

  const launcher = path.join(nm, "signals-pp-cli", "bin", "signals-pp-cli.js");
  const version = spawnSync(process.execPath, [launcher, "--version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SIGNALS_BASE_URL: "",
      SIGNALS_PP_CLI_VERSION_CHECK: "0",
    },
  });
  if (version.status !== 0 || !/signals-pp-cli\s+\S+/.test(version.stdout)) {
    console.error("npm launcher failed --version");
    console.error(version.stderr || version.stdout);
    process.exit(1);
  }

  console.log("signals-pp-cli npm package layout ok");
}

main();
