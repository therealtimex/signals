/**
 * Vitest globalSetup: migrate hermetic data dir, start production server, wait for health.
 * Writes `.ci/integration-server.json` for integration test workers.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const port = process.env.E2E_PORT ?? "3456";
const baseURL = `http://127.0.0.1:${port}`;
const dataDir =
  process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ??
  join(process.cwd(), ".ci", "signals-e2e");
const metaPath = join(process.cwd(), ".ci", "integration-server.json");

async function waitForHealth(maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${baseURL}/api/health`);
      if (res.ok) return;
    } catch {
      /* server still starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Integration server did not become healthy at ${baseURL}`);
}

export default async function setup() {
  if (process.env.E2E_FRESH_DB === "1" && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(process.cwd(), ".ci"), { recursive: true });

  const migrate = spawnSync("npm", ["run", "db:migrate"], {
    stdio: "inherit",
    env: { ...process.env, SIGNALS_DATA_DIR: dataDir },
  });
  if (migrate.status !== 0) {
    process.exit(migrate.status ?? 1);
  }

  const server = spawn("npx", ["next", "start", "-p", port], {
    stdio: "pipe",
    env: { ...process.env, SIGNALS_DATA_DIR: dataDir, PORT: port },
  });

  server.stdout?.on("data", (chunk) => {
    if (process.env.INTEGRATION_SERVER_LOG === "1") {
      process.stdout.write(chunk);
    }
  });
  server.stderr?.on("data", (chunk) => {
    if (process.env.INTEGRATION_SERVER_LOG === "1") {
      process.stderr.write(chunk);
    }
  });

  try {
    await waitForHealth();
  } catch (err) {
    server.kill("SIGTERM");
    throw err;
  }

  writeFileSync(
    metaPath,
    JSON.stringify({ baseURL, dataDir, port }, null, 2) + "\n",
    "utf8"
  );

  return async () => {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        server.kill("SIGKILL");
        resolve(undefined);
      }, 5000);
      server.on("exit", () => {
        clearTimeout(killTimer);
        resolve(undefined);
      });
      if (server.exitCode !== null) {
        clearTimeout(killTimer);
        resolve(undefined);
      }
    });
  };
}
