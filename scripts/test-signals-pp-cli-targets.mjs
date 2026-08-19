#!/usr/bin/env node
/** Golden smoke test for the hand-written `signals-pp-cli targets` command group. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform === "win32" ? "win32" : process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch;
const binary = path.join(root, "tools/signals-pp-cli/bin", `${platform}-${arch}`, "signals-pp-cli");

if (!fs.existsSync(binary)) {
  console.log(`skip: signals-pp-cli binary missing at ${binary}`);
  process.exit(0);
}

const output = execFileSync(binary, ["targets", "--help"], { encoding: "utf8" });
for (const command of ["list", "show", "prepare", "release"]) {
  if (!output.includes(command)) {
    console.error(`expected targets help to include ${command}`);
    process.exit(1);
  }
}
console.log("signals-pp-cli targets command group ok");
