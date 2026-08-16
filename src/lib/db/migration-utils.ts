import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function listMigrationSqlFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function applyMigrationFiles(sqlite: Database.Database, files: string[]): void {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split(/--> statement-breakpoint\n?/)) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

export function tableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

export function columnExists(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return rows.some((row) => row.name === columnName);
}

export function listAppliedMigrationTags(sqlite: Database.Database): Set<string> {
  if (!tableExists(sqlite, "__drizzle_migrations")) {
    return new Set();
  }
  const rows = sqlite
    .prepare("SELECT hash FROM __drizzle_migrations")
    .all() as { hash: string }[];
  return new Set(rows.map((row) => row.hash));
}
