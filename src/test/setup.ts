import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "@/lib/db/migrate";

if (!process.env.SIGNALS_DATA_DIR) {
  process.env.SIGNALS_DATA_DIR = mkdtempSync(join(tmpdir(), "signals-vitest-"));
}

runMigrations(process.env.SIGNALS_DATA_DIR);
