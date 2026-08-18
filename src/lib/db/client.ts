import { createRequire } from "node:module";
import { dirname, join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "./schema";

const require = createRequire(import.meta.url);

const isStandaloneBuild = process.env.SIGNALS_BOOT_MIGRATIONS_DONE === "1";
const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");

if (!isStandaloneBuild && !existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = isStandaloneBuild ? ":memory:" : join(dataDir, "data.db");
const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 10000");

let migrationsApplied = false;
function applyMigrationsOnce(): void {
  if (migrationsApplied) return;
  migrationsApplied = true;
  if (process.env.VITEST === "true") return;

  if (isStandaloneBuild) {
    const migrationsDir =
      process.env.SIGNALS_MIGRATIONS_DIR?.replace("~", homedir()) ??
      join(dirname(fileURLToPath(import.meta.url)), "migrations");
    if (existsSync(migrationsDir)) {
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: migrationsDir });
    }
    return;
  }

  require("./migrate").runMigrations(dataDir);
}

applyMigrationsOnce();

export const db = drizzle(sqlite, { schema });
export { sqlite };
export type DbRunner = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
export { dataDir, dbPath };
