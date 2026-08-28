#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const requestedWorktree = process.env.SIGNALS_QA_WORKTREE?.trim() || "";
if (!isAbsolute(requestedWorktree) || !existsSync(requestedWorktree)) {
  console.error("SIGNALS_QA_WORKTREE must identify an existing absolute Signals worktree.");
  process.exit(2);
}

const worktree = realpathSync(requestedWorktree);
const packagePath = join(worktree, "package.json");
if (!existsSync(packagePath)) {
  console.error(`Signals QA worktree has no package.json: ${worktree}`);
  process.exit(2);
}
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
if (packageJson.name !== "@realtimex/signals") {
  console.error(`Refusing to launch a non-Signals source directory: ${worktree}`);
  process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["run", "dev"], {
  cwd: worktree,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Could not start Signals QA worktree: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
