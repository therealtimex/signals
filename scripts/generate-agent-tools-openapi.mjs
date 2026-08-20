#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const result = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "--project",
    "unit",
    "src/lib/agent-tools/openapi-codegen.test.ts",
  ],
  {
    cwd: root,
    env: { ...process.env, GENERATE_AGENT_TOOLS_OPENAPI: "1" },
    encoding: "utf8",
    shell: false,
  }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
