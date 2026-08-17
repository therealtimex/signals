import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, "data.db");
const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 10000");

let migrationsApplied = false;
function applyMigrationsOnce(): void {
  if (migrationsApplied) return;
  migrationsApplied = true;
  if (process.env.VITEST === "true") return;
  require(join(moduleDir, "migrate")).runMigrations(dataDir);
}

applyMigrationsOnce();

export const db = drizzle(sqlite, { schema });
export { sqlite };
export type DbRunner = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
export { dataDir, dbPath };
