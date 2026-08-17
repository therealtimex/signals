#!/usr/bin/env node
/**
 * Smoke test: packaged signals-publish skill resolves host agent-browser via env injection.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fakeAb = join(root, "scripts/fixtures/fake-agent-browser.cjs");
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
    "x-publish.cjs"
  );
  const payloadPath = join(workDir, "payload.json");
  const stateFile = join(workDir, "fake-ab-state.json");
  writeFileSync(payloadPath, JSON.stringify({ text: "smoke test" }));
  readFileSync(scriptPath);

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--port", "9222", "--payload", payloadPath, "--dry-run"],
    {
      cwd: join(workDir, "signals-publish"),
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_BIN: process.execPath,
        AGENT_BROWSER_BIN_ARGS: fakeAb,
        SIGNALS_PUBLISH_AB_SESSION: "signals-publish-smoke",
        FAKE_AB_STATE_FILE: stateFile,
      },
    }
  );

  const output = `${result.stdout}\n${result.stderr}`;
  if (/Cannot find module 'playwright-core'/.test(output)) {
    throw new Error(`playwright-core should not be required:\n${output}`);
  }
  if (/agent-browser CLI not found/.test(output)) {
    throw new Error(`agent-browser missing from packaged skill run:\n${output}`);
  }

  const lastStdoutLine =
    result.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    const parsed = JSON.parse(lastStdoutLine);
    if (typeof parsed.success !== "boolean") {
      throw new Error(
        `Expected JSON result on last stdout line: ${lastStdoutLine}`
      );
    }
    if (!parsed.success || !parsed.dryRun) {
      throw new Error(`Packaged skill dry-run failed:\n${output}`);
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Packaged skill did not emit JSON result:\n${output}`);
    }
    throw err;
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
