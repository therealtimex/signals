#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchSignalsCliSource } from "../tools/signals-pp-cli/patch/patchSignalsCliSource.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI_NAME = "signals-pp-cli";
const OPENAPI_PATH = path.join(ROOT, "openapi", "agent-tools.json");
const TOOLS_ROOT = path.join(ROOT, "tools", "signals-pp-cli");
const SOURCE_DIR = path.join(TOOLS_ROOT, "source");
const TRANSCENDENCE_DIR = path.join(TOOLS_ROOT, "transcendence");
const BIN_ROOT = path.join(TOOLS_ROOT, "bin");
const CLI_PRINTING_PRESS_PACKAGE =
  "github.com/mvanhorn/cli-printing-press/v4/cmd/cli-printing-press@v4.20.1";
const MIN_GO_TOOLCHAIN = "go1.26.6";

if (!process.env.GOTOOLCHAIN) {
  process.env.GOTOOLCHAIN = `${MIN_GO_TOOLCHAIN}+auto`;
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

function commandOutput(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureGo() {
  if (commandOutput("go", ["version"])) return;
  throw new Error("Go is required to build signals-pp-cli");
}

function ensureCliPrintingPress() {
  const goBin = process.env.GOBIN || path.join(os.homedir(), "go", "bin");
  if (!String(process.env.PATH || "").split(path.delimiter).includes(goBin)) {
    process.env.PATH = `${goBin}${path.delimiter}${process.env.PATH || ""}`;
  }
  const pinnedVersion = CLI_PRINTING_PRESS_PACKAGE.split("@").pop();
  const installedVersion = commandOutput("cli-printing-press", ["--version"])
    .split(" ")
    .pop();
  if (commandOutput("which", ["cli-printing-press"]) && installedVersion === pinnedVersion) {
    return;
  }
  run("go", ["install", CLI_PRINTING_PRESS_PACKAGE], {
    env: { ...process.env, GOBIN: goBin },
  });
}

function goTarget() {
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const cpu = process.arch === "x64" ? "x64" : process.arch;
  return {
    goos: platform === "win32" ? "windows" : platform,
    goarch: cpu === "x64" ? "amd64" : cpu,
    npmOs: platform,
    npmCpu: cpu,
  };
}

function copyTranscendence() {
  const destDir = path.join(SOURCE_DIR, "internal", "cli");
  for (const entry of fs.readdirSync(TRANSCENDENCE_DIR)) {
    if (!entry.endsWith(".go")) continue;
    fs.copyFileSync(
      path.join(TRANSCENDENCE_DIR, entry),
      path.join(destDir, entry)
    );
  }
}

function writePlatformShim(targetDir) {
  const shimPath = path.join(targetDir, `${CLI_NAME}.js`);
  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const arch = process.arch === "x64" ? "x64" : process.arch;
const platform = process.platform === "win32" ? "win32" : process.platform;
const binaryName = process.platform === "win32" ? "${CLI_NAME}.exe" : "${CLI_NAME}";
const candidates = [
  path.join(__dirname, platform + "-" + arch, binaryName),
  path.join(__dirname, binaryName),
];
const binaryPath = candidates.find((candidate) => fs.existsSync(candidate));
if (!binaryPath) {
  console.error("signals-pp-cli binary not found for " + platform + "-" + arch);
  process.exit(1);
}
const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
`
  );
  fs.chmodSync(shimPath, 0o755);
}

function buildBinary(target) {
  const binaryName = target.goos === "windows" ? `${CLI_NAME}.exe` : CLI_NAME;
  const outDir = path.join(BIN_ROOT, `${target.npmOs}-${target.npmCpu}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, binaryName);
  run(
    "go",
    [
      "build",
      "-ldflags",
      `-X signals-pp-cli/internal/cli.version=${readJson(path.join(ROOT, "package.json")).version}`,
      "-o",
      outPath,
      `./cmd/${CLI_NAME}`,
    ],
    {
      cwd: SOURCE_DIR,
      env: {
        ...process.env,
        GOOS: target.goos,
        GOARCH: target.goarch,
        CGO_ENABLED: "0",
        GOCACHE:
          process.env.GOCACHE || path.join(os.tmpdir(), "signals-pp-cli-go-build-cache"),
      },
    }
  );
  if (target.goos !== "windows") fs.chmodSync(outPath, 0o755);
  return outPath;
}

const CROSS_TARGETS = [
  { goos: "darwin", goarch: "arm64", npmOs: "darwin", npmCpu: "arm64" },
  { goos: "darwin", goarch: "amd64", npmOs: "darwin", npmCpu: "x64" },
  { goos: "linux", goarch: "arm64", npmOs: "linux", npmCpu: "arm64" },
  { goos: "linux", goarch: "amd64", npmOs: "linux", npmCpu: "x64" },
];

function main() {
  const version = String(readJson(path.join(ROOT, "package.json")).version || "").trim();
  if (!version) throw new Error("package.json version missing");

  if (!fs.existsSync(OPENAPI_PATH)) {
    run("node", [path.join(ROOT, "scripts", "generate-agent-tools-openapi.mjs")], {
      cwd: ROOT,
    });
  }

  ensureGo();
  ensureCliPrintingPress();

  fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
  run("cli-printing-press", [
    "generate",
    "--spec",
    OPENAPI_PATH,
    "--name",
    CLI_NAME,
    "--output",
    SOURCE_DIR,
    "--force",
  ]);

  patchSignalsCliSource(SOURCE_DIR, version);
  copyTranscendence();

  const targets =
    process.env.SIGNALS_PP_CLI_CROSS_COMPILE === "1"
      ? CROSS_TARGETS
      : [goTarget()];
  for (const target of targets) {
    buildBinary(target);
  }

  fs.mkdirSync(BIN_ROOT, { recursive: true });
  writePlatformShim(BIN_ROOT);

  console.log(
    `[signals-pp-cli] built ${CLI_NAME} ${version} for ${targets
      .map((target) => `${target.npmOs}/${target.npmCpu}`)
      .join(", ")}`
  );
}

main();
