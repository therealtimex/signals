import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOST_COMMIT = "6dbf8b5";
const ROUTES_REL = "server/endpoints/sdk/personalityTransactions.js";
const CAPABILITIES_REL = "server/endpoints/sdk/capabilities.js";
const CONSTANTS_REL = "server/utils/personality/writer/constants.js";
const COORDINATOR_REL = "server/utils/personality/writer/coordinator.js";

function resolveAppRepo(): { path: string | null; explicit: boolean } {
  const explicit = process.env.RTX_APP_REPO?.trim();
  if (explicit) return { path: resolve(explicit), explicit: true };
  for (const candidate of [
    resolve(process.cwd(), "../realtimex-ai-app"),
    resolve(process.cwd(), "../../rtgit/realtimex-ai-app"),
    resolve(process.cwd(), "../../realtimex-ai-app"),
  ]) {
    if (existsSync(join(candidate, ROUTES_REL))) return { path: candidate, explicit: false };
  }
  return { path: null, explicit: false };
}

const { path: appRepo, explicit } = resolveAppRepo();
const usable = Boolean(appRepo && [
  ROUTES_REL,
  CAPABILITIES_REL,
  CONSTANTS_REL,
  COORDINATOR_REL,
].every((path) => existsSync(join(appRepo, path))));
const misconfigured = explicit && !usable;

describe("Personality writer runtime contract", () => {
  it.runIf(misconfigured)("rejects an unusable RTX_APP_REPO", () => {
    expect.fail(`RTX_APP_REPO does not contain the Personality writer contract: ${appRepo}`);
  });
});

describe.skipIf(!usable || misconfigured)("Personality writer runtime contract", () => {
  it("targets a host containing the foundational #1729 commit", () => {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", HOST_COMMIT, "HEAD"], {
      cwd: appRepo as string,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("pins the exact capability key, permission, v1 limits, and allowlist", () => {
    const script = `
      const value = require("./${CONSTANTS_REL}");
      process.stdout.write(JSON.stringify({
        key: value.CAPABILITY_KEY,
        permission: value.PERMISSION,
        pattern: value.ALLOWED_FILE_PATTERN,
        excluded: value.EXCLUDED_FILES,
        maxFiles: value.MAX_FILES,
        maxFileBytes: value.MAX_FILE_BYTES,
      }));
    `;
    const result = spawnSync("node", ["-e", script], {
      cwd: appRepo as string,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      key: "workspace.personality.transactions",
      permission: "workspace.personality.write",
      pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}\\.md$",
      excluded: ["HEARTBEAT.md", "MEMORY.md", "CLAUDE.md"],
      maxFiles: 16,
      maxFileBytes: 1024 * 1024,
    });
  });

  it("pins every authenticated route and the landed terminal/replay semantics", () => {
    const routes = readFileSync(join(appRepo as string, ROUTES_REL), "utf8");
    const capability = readFileSync(join(appRepo as string, CAPABILITIES_REL), "utf8");
    const coordinator = readFileSync(join(appRepo as string, COORDINATOR_REL), "utf8");
    expect(routes).toContain('"/sdk/workspaces/:slug/personality-files"');
    expect(routes).toContain('"/sdk/workspaces/:slug/personality-files/transactions/:transactionId"');
    expect(routes).toContain('"/sdk/workspaces/:slug/personality-files/transactions/:transactionId/recover"');
    expect(routes).toContain('request.body?.mode !== "restore"');
    expect(routes).toContain('response.set("Retry-After", "2")');
    expect(routes).toContain('response.set("X-RealTimeX-Transaction-Replayed", "true")');
    expect(capability).toContain("schemaVersions: [1]");
    expect(capability).toContain('fileHash: "sha256-hex"');
    expect(coordinator).toContain('record.status = "resolved_discarded"');
    expect(coordinator).toContain('status: "not_started"');
    expect(coordinator).toContain("TRANSACTION_REQUEST_MISMATCH");
  });
});
