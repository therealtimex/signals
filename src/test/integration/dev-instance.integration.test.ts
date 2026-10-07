/**
 * Signals Dev instance against the production build (#541, ADR-541-5, design §5).
 *
 * The shared globalSetup boots the canonical smoke server; this file boots its own second server
 * from the same build with the env the Dev-app launcher pins (SIGNALS_INSTANCE=dev,
 * SIGNALS_SCHEDULER_ENABLED=0), on a free port and a throwaway data dir, so the other integration
 * tests are untouched. The server runs standalone (no RTX_* env), so it cannot reach a RealTimeX
 * host either.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const DUE_JOB_ID = "dev-instance-due-job";

let server: ChildProcess | null = null;
let serverLog = "";
let baseUrl = "";
let dataDir = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function devInstanceEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("RTX_") || key.startsWith("REALTIMEX_")) delete env[key];
  }
  delete env.SERVER_URL;
  return {
    ...env,
    NODE_ENV: "production",
    SIGNALS_INSTANCE: "dev",
    SIGNALS_SCHEDULER_ENABLED: "0",
    SIGNALS_DATA_DIR: dataDir,
    PORT: String(port),
  };
}

async function waitForHealth(maxMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (server?.exitCode !== null) {
      throw new Error(`Dev instance server exited early (${server?.exitCode}):\n${serverLog}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dev instance server did not become healthy at ${baseUrl}:\n${serverLog}`);
}

function readDb<T>(read: (db: Database.Database) => T): T {
  const db = new Database(join(dataDir, "data.db"), { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

describe("Signals Dev instance on the production build (ADR-541-5)", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "signals-dev-instance-it-"));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const env = devInstanceEnv(port);

    const migrate = spawnSync("npm", ["run", "db:migrate"], { cwd: ROOT, env, encoding: "utf8" });
    if (migrate.status !== 0) {
      throw new Error(`db:migrate failed:\n${migrate.stdout}\n${migrate.stderr}`);
    }

    // A job that is already due before the server starts. With the scheduler on, the boot sweep
    // would claim it (an unknown type with no template fails); with it off, it must stay untouched.
    const db = new Database(join(dataDir, "data.db"));
    try {
      db.prepare(
        `INSERT INTO scheduled_jobs (id, job_type, payload, status, run_at, max_retries, enabled)
         VALUES (?, 'signals-541:due-probe', '{}', 'pending', ?, 0, 1)`,
      ).run(DUE_JOB_ID, Math.floor(Date.now() / 1000) - 3600);
    } finally {
      db.close();
    }

    // The launcher records the slot's needs here (#545); a Dev app asks RealTimeX only for these.
    mkdirSync(join(dataDir, ".launcher"));
    writeFileSync(join(dataDir, ".launcher", "needs.json"), JSON.stringify({ needs: ["llm.chat", "not.in.manifest"] }));

    server = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env,
      stdio: "pipe",
    });
    server.stdout?.on("data", (chunk) => (serverLog += String(chunk)));
    server.stderr?.on("data", (chunk) => (serverLog += String(chunk)));

    await waitForHealth();
    // Let anything the boot hook scheduled settle before the scheduler assertion reads the row.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill("SIGTERM");
      const timer = setTimeout(() => server?.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("asks RealTimeX only for the slot's needs, filtered to the manifest (#545)", async () => {
    const body = await (await fetch(`${baseUrl}/api/rtx/status`)).json();
    expect(body.permissions).toEqual(["llm.chat"]);
    expect(body.manifest.permissions).toHaveLength(8);
  });

  it("reports the instance block the launcher verifies", async () => {
    const body = await (await fetch(`${baseUrl}/api/health`)).json();
    expect(body).toMatchObject({ status: "ok", app: "signals", rtx: { mode: "standalone" } });
    expect(body.instance).toEqual({
      kind: "dev",
      externalEffects: "denied",
      scheduler: "disabled",
      dataDir,
    });
  });

  it.each([
    ["POST", "/api/content/send-to-agent", { contentItemId: "missing", platforms: ["x"], text: "t" }, "publish.dispatch"],
    ["POST", "/api/platforms/x/compose", { tweets: ["hello from a dev app"] }, "publish.x-api"],
    ["POST", "/api/platforms/x/engage", { action: "like", tweetId: "1" }, "engage.x-api"],
    ["GET", "/api/platforms/x/auth", undefined, "oauth.connect"],
    ["GET", "/api/platforms/linkedin/auth", undefined, "oauth.connect"],
    ["GET", "/api/platforms/gmail/auth", undefined, "oauth.connect"],
    ["GET", "/api/platforms/x/callback?code=abc&state=def", undefined, "oauth.connect"],
    ["POST", "/api/platforms/x/browser-session", { action: "setup" }, "publish.browser"],
  ] as const)("%s %s answers 403 DEV_INSTANCE_GUARD", async (method, path, body, effect) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: "manual",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect,
    });
  });

  it("keeps drafts local and refuses to dispatch one: 403, no publish job, draft unchanged", async () => {
    const draft = await (
      await fetch(`${baseUrl}/api/platforms/x/compose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweets: ["dev draft"], saveAsDraft: true }),
      })
    ).json();
    expect(draft).toMatchObject({ success: true, draft: true });

    const response = await fetch(`${baseUrl}/api/content/send-to-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentItemId: draft.contentItemId, platforms: ["x"], text: "dev draft" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "DEV_INSTANCE_GUARD", effect: "publish.dispatch" });
    expect(readDb((db) => db.prepare("SELECT COUNT(*) AS n FROM publish_jobs").get())).toEqual({ n: 0 });
    expect(
      readDb((db) => db.prepare("SELECT status FROM content_items WHERE id = ?").get(draft.contentItemId)),
    ).toEqual({ status: "draft" });
  });

  it("leaves DB-only routes alone: platform-targets/connections still answers 200", async () => {
    const response = await fetch(`${baseUrl}/api/platform-targets/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionName: "signals-dev-it", kind: "dedicated" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connection: { sessionName: "signals-dev-it" } });
  });

  it("keeps a due scheduled job pending: the scheduler never ran it", () => {
    const row = readDb((db) =>
      db
        .prepare(
          "SELECT status, started_at, completed_at, retry_count, error, last_triggered_at FROM scheduled_jobs WHERE id = ?",
        )
        .get(DUE_JOB_ID),
    );
    expect(row).toEqual({
      status: "pending",
      started_at: null,
      completed_at: null,
      retry_count: 0,
      error: null,
      last_triggered_at: null,
    });
    expect(serverLog).toContain("[scheduler] Disabled by SIGNALS_SCHEDULER_ENABLED");
  });
});
