import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defineContract } from "./experience-contract.mjs";
import {
  contractPaths,
  fixtureResultFromProcess,
  parseArgs,
  runExperienceContract,
} from "./run-experience-contract.mjs";

test("parseArgs supports positional and named contract ids", () => {
  assert.equal(parseArgs(["issue-413-review-path"]).contractId, "issue-413-review-path");
  const named = parseArgs(["--contract=issue-413-review-path", "--cdp=http://127.0.0.1:9889", "--prefix", "before"]);
  assert.equal(named.cdp, true);
  assert.equal(named.cdpUrl, "http://127.0.0.1:9889");
  assert.equal(named.prefix, "before");
});

test("parseArgs rejects missing ids, unknown options, and invalid prefixes", () => {
  assert.throws(() => parseArgs([]), /contract id is required/);
  assert.throws(() => parseArgs(["issue-413-review-path", "--wat"]), /Unknown option/);
  assert.throws(() => parseArgs(["issue-413-review-path", "--prefix", "during"]), /before or after/);
});

test("contractPaths keeps contracts beside scenarios", () => {
  const paths = contractPaths("/repo", "example");
  assert.equal(paths.contractPath, "/repo/scripts/app-automation/scenarios/example.contract.mjs");
  assert.equal(paths.scenarioPath, "/repo/scripts/app-automation/scenarios/example.mjs");
});

test("runner writes a passed manifest with a fake scenario", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "signals-contract-"));
  const value = defineContract({
    id: "fake-contract",
    issue: 413,
    kind: "review",
    reachability: { status: "reachable" },
    evidence: { profile: "assertions", gtm: false },
    promise: "State agrees.",
    checkpoints: [{ id: "state-agrees", data: "same", assert: ({ data }) => data === "same" }],
  });
  const result = await runExperienceContract(
    { ...parseArgs(["fake-contract"]), outputDir },
    {
      repoDir: "/repo",
      importModule: async (path) => path.endsWith(".contract.mjs")
        ? { default: value }
        : { default: async ({ record }) => record("state-agrees", { data: "same" }) },
      resolveOrigin: async () => ({ ok: true, origin: "http://127.0.0.1:3010", source: "base-url", healthApp: "signals" }),
      getGitState: () => ({ sha: "abc", dirty: false }),
      chromium: {},
      createSession: async () => ({ page: {}, close: async () => {} }),
    },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.manifest.result, "passed");
  assert.equal(JSON.parse(readFileSync(result.manifestPath, "utf8")).contract.id, "fake-contract");
});

test("target failures use the not-ready exit code and write no manifest", async () => {
  const value = defineContract({
    id: "fake-contract",
    issue: 413,
    kind: "negative",
    reachability: { status: "reachable" },
    evidence: { profile: "assertions", gtm: false },
    promise: "Target is available.",
    checkpoints: [{ id: "target-ready", data: "ready", assert: () => true }],
  });
  const result = await runExperienceContract(parseArgs(["fake-contract"]), {
    repoDir: "/repo",
    importModule: async () => ({ default: value }),
    resolveOrigin: async () => ({ ok: false, code: "local_app_stopped", message: "stopped" }),
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.manifest, null);
});

test("an actual nonzero fixture child preserves its precondition code and reasons", () => {
  const payload = {
    ok: false,
    code: "fixture_precondition_unmet",
    error: "fixture_precondition_unmet: bind Personality",
    reasons: ["bind Personality"],
  };
  const child = spawnSync(process.execPath, [
    "-e",
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))}); process.exit(1)`,
  ], { encoding: "utf8" });

  assert.throws(
    () => fixtureResultFromProcess(child),
    (error) => {
      assert.equal(error.code, "fixture_precondition_unmet");
      assert.deepEqual(error.reasons, ["bind Personality"]);
      assert.equal(error.exitCode, 1);
      return true;
    },
  );
});

test("runner returns not-ready and writes fixture reasons into the manifest", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "signals-contract-precondition-"));
  const value = defineContract({
    id: "fake-contract",
    issue: 413,
    kind: "review",
    reachability: { status: "reachable" },
    fixture: "nurture-proposals",
    evidence: { profile: "assertions", gtm: false },
    promise: "Fixture is ready.",
    checkpoints: [{ id: "fixture-ready", data: "ready", assert: () => true }],
  });
  const result = await runExperienceContract(
    { ...parseArgs(["fake-contract"]), dataDir: "/tmp/disposable", outputDir },
    {
      repoDir: "/repo",
      importModule: async (path) => path.endsWith(".contract.mjs")
        ? { default: value }
        : { default: async () => {} },
      resolveOrigin: async () => ({ ok: true, origin: "http://127.0.0.1:3010", source: "base-url", healthApp: "signals" }),
      getGitState: () => ({ sha: "abc", dirty: false }),
      runFixture: async () => {
        throw Object.assign(new Error("fixture_precondition_unmet: bind Personality"), {
          code: "fixture_precondition_unmet",
          reasons: ["bind Personality"],
        });
      },
    },
  );

  assert.equal(result.exitCode, 3);
  assert.deepEqual(result.manifest.failures.at(-1), {
    code: "fixture_precondition_unmet",
    detail: "fixture_precondition_unmet: bind Personality",
    reasons: ["bind Personality"],
  });
});
