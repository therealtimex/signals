#!/usr/bin/env node
/**
 * Golden test: signals-pp-cli import contacts reads CSV and emits summary JSON.
 * Skips when the native binary is not built for this host.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const platform = process.platform === "win32" ? "win32" : process.platform;
const arch = process.arch === "x64" ? "x64" : process.arch;
const binary = path.join(root, "tools/signals-pp-cli/bin", `${platform}-${arch}`, "signals-pp-cli");
const fixture = path.join(root, "test/fixtures/contacts-import.csv");

if (!fs.existsSync(binary)) {
  console.log(`skip: signals-pp-cli binary missing at ${binary}`);
  process.exit(0);
}

const output = execFileSync(
  binary,
  ["import", "contacts", "--file", fixture, "--dry-run"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      SIGNALS_BASE_URL: process.env.SIGNALS_BASE_URL || "http://127.0.0.1:30999",
    },
  }
).trim();

const summary = JSON.parse(output.split("\n").pop() || "{}");
if (typeof summary.success !== "boolean") {
  console.error("expected JSON summary with success boolean");
  process.exit(1);
}
console.log("signals-pp-cli import contacts dry-run summary ok");
