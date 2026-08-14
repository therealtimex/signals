import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const port = process.env.PORT ?? "3456";
const dataDir =
  process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ??
  join(process.cwd(), ".ci", "signals-e2e");

if (process.env.E2E_FRESH_DB === "1" && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
}

mkdirSync(dataDir, { recursive: true });

const migrate = spawnSync("npm", ["run", "db:migrate"], {
  stdio: "inherit",
  env: { ...process.env, SIGNALS_DATA_DIR: dataDir },
});

if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const server = spawn("npx", ["next", "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, SIGNALS_DATA_DIR: dataDir, PORT: port },
});

const shutdown = (signal) => {
  server.kill(signal);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("exit", (code) => {
  process.exit(code ?? 0);
});
