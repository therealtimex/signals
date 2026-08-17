#!/usr/bin/env node
/**
 * Smoke test: packaged signals-publish skill resolves playwright-core in a clean dir.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outZip = join(tmpdir(), `signals-publish-smoke-${Date.now()}.zip`);
const workDir = mkdtempSync(join(tmpdir(), "signals-publish-smoke-"));

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`
    );
  }
  return result;
}

try {
  run("bash", [join(root, "scripts/package-signals-publish-skill.sh"), outZip]);
  run("unzip", ["-q", outZip, "-d", workDir]);

  const scriptPath = join(
    workDir,
    "signals-publish",
    "scripts",
    "x-publish.mjs"
  );
  const payloadPath = join(workDir, "payload.json");
  writeFileSync(payloadPath, JSON.stringify({ text: "smoke test" }));
  readFileSync(scriptPath);

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--port", "9222", "--payload", payloadPath],
    { cwd: join(workDir, "signals-publish"), encoding: "utf8" }
  );

  const output = `${result.stdout}\n${result.stderr}`;
  if (/ERR_MODULE_NOT_FOUND/.test(output) || /Cannot find package 'playwright-core'/.test(output)) {
    throw new Error(`playwright-core missing from packaged skill:\n${output}`);
  }

  console.log("signals-publish skill package smoke: OK");
} finally {
  rmSync(workDir, { recursive: true, force: true });
  try {
    rmSync(outZip);
  } catch {
    // ignore
  }
}
