#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const MAIN_PACKAGE_NAME = "@realtimex/signals-pp-cli";
const binaryName = process.platform === "win32" ? "signals-pp-cli.exe" : "signals-pp-cli";
const platformPackageName =
  "@realtimex/signals-pp-cli-" + process.platform + "-" + process.arch;

function readPackageVersion(packageJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version || null;
  } catch (_) {
    return null;
  }
}

function installedCliVersion() {
  try {
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    return readPackageVersion(packageJsonPath);
  } catch (_) {
    return null;
  }
}

function warnVersionMismatch(expectedVersion) {
  const installed = installedCliVersion();
  if (!expectedVersion || !installed || expectedVersion === installed) return;
  console.error(
    "warning: " +
      MAIN_PACKAGE_NAME +
      " is " +
      installed +
      " but the running Signals Local App expects cliVersion " +
      expectedVersion +
      ". Prefer: npx --yes " +
      MAIN_PACKAGE_NAME +
      "@" +
      expectedVersion +
      " <command>",
  );
}

async function readHealthCliVersion() {
  if (process.env.SIGNALS_PP_CLI_VERSION_CHECK === "0") return null;
  const baseUrl = String(process.env.SIGNALS_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  try {
    const response = await fetch(baseUrl + "/api/health", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.cliVersion === "string" ? body.cliVersion : null;
  } catch (_) {
    return null;
  }
}

function resolveBinaryPath() {
  try {
    return path.join(
      path.dirname(require.resolve(platformPackageName + "/package.json")),
      "bin",
      binaryName,
    );
  } catch (error) {
    const localPackagePath = path.resolve(
      __dirname,
      "..",
      "..",
      "packages",
      process.platform + "-" + process.arch,
      "package.json",
    );
    if (fs.existsSync(localPackagePath)) {
      return path.join(path.dirname(localPackagePath), "bin", binaryName);
    }
    console.error(
      "Unsupported platform for " + MAIN_PACKAGE_NAME + ": " + process.platform + "/" + process.arch,
    );
    console.error("Expected optional package: " + platformPackageName);
    process.exit(1);
  }
}

async function main() {
  const expectedVersion = await readHealthCliVersion();
  warnVersionMismatch(expectedVersion);

  const binaryPath = resolveBinaryPath();
  const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
