#!/usr/bin/env node
/**
 * Golden test: the bundled platform-selecting launcher actually runs (#222).
 *
 * The launcher is generated CommonJS. It shipped as `.js` for a while, which
 * meant Node parsed it as ESM under this package's `"type": "module"` and it
 * died on `require` before reaching the binary. Nothing executed it in CI —
 * the sibling scripts exec the platform binary directly — so the break was
 * invisible. This closes that gap.
 *
 * Skips when the native binary is not built for this host.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "tools/signals-pp-cli/bin");
const platform = process.platform === "win32" ? "win32" : process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch;
const binaryName = process.platform === "win32" ? "signals-pp-cli.exe" : "signals-pp-cli";
const binary = path.join(binDir, `${platform}-${arch}`, binaryName);
const launcher = path.join(binDir, "signals-pp-cli.cjs");

if (!fs.existsSync(binary)) {
  console.log(`skip: signals-pp-cli binary missing at ${binary}`);
  process.exit(0);
}

if (!fs.existsSync(launcher)) {
  console.error(`expected launcher at ${launcher}`);
  console.error("run: npm run build:signals-pp-cli");
  process.exit(1);
}

// A stray signals-pp-cli.js is parsed as ESM under this package's
// `"type": "module"` and is the exact bug this test exists to prevent. `bin/` is
// gitignored and not cleaned between builds, so the usual cause is a leftover
// from a pre-#222 build rather than a regression in the generator.
const staleJsLauncher = path.join(binDir, "signals-pp-cli.js");
if (fs.existsSync(staleJsLauncher)) {
  console.error(`unexpected ${staleJsLauncher}`);
  console.error(
    "stale signals-pp-cli.js from a pre-#222 build — delete it or re-run npm run build:signals-pp-cli",
  );
  console.error('(the launcher must be .cjs: a .js file is parsed as ESM under "type": "module")');
  process.exit(1);
}

function runLauncher(args) {
  return spawnSync(process.execPath, [launcher, ...args], { encoding: "utf8" });
}

const version = runLauncher(["--version"]);
if (version.status !== 0) {
  console.error(`launcher exited ${version.status} for --version`);
  console.error(version.stderr || version.stdout);
  process.exit(1);
}
if (!/signals-pp-cli\s+\S+/.test(version.stdout)) {
  console.error(`unexpected --version output: ${JSON.stringify(version.stdout)}`);
  process.exit(1);
}

// The launcher's whole job is to be transparent: arguments in, exit code out.
const help = runLauncher(["reconcile", "--help"]);
if (help.status !== 0 || !help.stdout.includes("--merge")) {
  console.error("launcher did not forward args to the binary");
  console.error(help.stderr || help.stdout);
  process.exit(1);
}

const failure = runLauncher(["definitely-not-a-command"]);
if (failure.status === 0) {
  console.error("launcher swallowed a non-zero exit code from the binary");
  process.exit(1);
}

console.log("signals-pp-cli launcher ok");
