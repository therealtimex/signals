#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "openapi", "agent-tools.json");

if (!fs.existsSync(outPath)) {
  console.error(`Missing checked-in OpenAPI spec: ${outPath}`);
  console.error("Run: npm run generate:agent-tools-openapi");
  process.exit(1);
}

const checkedIn = fs.readFileSync(outPath, "utf8");
const tempPath = path.join(
  os.tmpdir(),
  `signals-agent-tools-openapi-${process.pid}.json`
);

const generate = spawnSync("node", ["scripts/generate-agent-tools-openapi.mjs"], {
  cwd: root,
  encoding: "utf8",
  shell: false,
  env: {
    ...process.env,
    GENERATE_AGENT_TOOLS_OPENAPI_OUT_PATH: tempPath,
  },
});

if (generate.status !== 0) {
  console.error(generate.stderr || generate.stdout || "generate-agent-tools-openapi failed");
  fs.rmSync(tempPath, { force: true });
  process.exit(generate.status ?? 1);
}

if (!fs.existsSync(tempPath)) {
  console.error(`Generator did not write temp OpenAPI spec: ${tempPath}`);
  process.exit(1);
}

const generated = fs.readFileSync(tempPath, "utf8");
fs.rmSync(tempPath, { force: true });

if (checkedIn !== generated) {
  console.error(
    "openapi/agent-tools.json is out of date. Run: npm run generate:agent-tools-openapi"
  );
  const diff = spawnSync("git", ["diff", "--no-index", "--", outPath, "-"], {
    cwd: root,
    encoding: "utf8",
    input: generated,
  });
  if (diff.stdout) console.error(diff.stdout);
  process.exit(1);
}

console.log("openapi/agent-tools.json matches registry");
