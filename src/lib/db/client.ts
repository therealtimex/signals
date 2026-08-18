import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

const require = createRequire(import.meta.url);

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, "data.db");
const sqlite = new Database(
  dbPath,
  process.env.SIGNALS_BOOT_MIGRATIONS_DONE === "1" ? { readonly: true } : undefined,
);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 10000");

let migrationsApplied = false;
function applyMigrationsOnce(): void {
  if (migrationsApplied) return;
  migrationsApplied = true;
  if (process.env.VITEST === "true") return;
  if (process.env.SIGNALS_BOOT_MIGRATIONS_DONE === "1") return;
  require("./migrate").runMigrations(dataDir);
}

applyMigrationsOnce();

export const db = drizzle(sqlite, { schema });
export { sqlite };
export type DbRunner = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
export { dataDir, dbPath };
