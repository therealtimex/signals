import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { resolveHomePrefixedPath, resolveSignalsDataDir } from "@/lib/signals-data-dir";
import { mkdirSync, existsSync } from "fs";
import { ensureEmploymentBackfillBeforeCompanyDrop } from "@/lib/db/migrate-employment-pre-drop";
import { ensureChannelBackfillBeforeDrop } from "@/lib/db/migrate-channel-pre-drop";
import { ensureMediaAttachmentBackfillBeforeDrop } from "@/lib/db/migrate-media-pre-drop";
import { ensureAvatarBackfillBeforeDrop } from "@/lib/db/migrate-avatar-pre-drop";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(dataDir?: string) {
  const dir = dataDir ?? resolveSignalsDataDir();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const dbPath = join(dir, "data.db");
  ensureEmploymentBackfillBeforeCompanyDrop(dbPath);
  ensureChannelBackfillBeforeDrop(dbPath);
  ensureMediaAttachmentBackfillBeforeDrop(dbPath);
  ensureAvatarBackfillBeforeDrop(dbPath);

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);

  const migrationsDir =
    resolveHomePrefixedPath(process.env.SIGNALS_MIGRATIONS_DIR) ??
    join(__dirname, "migrations");
  if (existsSync(migrationsDir)) {
    migrate(db, { migrationsFolder: migrationsDir });
  }

  sqlite.close();
  return dbPath;
}
