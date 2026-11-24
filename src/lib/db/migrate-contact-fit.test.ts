import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const MIGRATION_SQL = readFileSync(
  new URL("./migrations/0039_contact_fit_scoring.sql", import.meta.url),
  "utf8",
);

const FIT_COLUMNS = {
  fit_score: "INTEGER",
  fit_tier: "TEXT",
  fit_product: "TEXT",
  fit_confidence: "REAL",
  fit_rationale: "TEXT",
  fit_score_version: "TEXT",
  fit_scored_at: "INTEGER",
} as const;

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown };

function contactColumns(sqlite: Database.Database): Map<string, ColumnInfo> {
  const rows = sqlite.prepare("PRAGMA table_info(contacts)").all() as ColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

function expectNullableFitColumns(sqlite: Database.Database) {
  const columns = contactColumns(sqlite);
  for (const [name, type] of Object.entries(FIT_COLUMNS)) {
    const column = columns.get(name);
    expect(column, name).toBeDefined();
    expect(column?.type.toUpperCase(), name).toBe(type);
    expect(column?.notnull, name).toBe(0);
    expect(column?.dflt_value, name).toBeNull();
  }
  expect(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_contacts_fit_score'")
      .get(),
  ).toBeTruthy();
}

describe("0039 contact fit scoring migration", () => {
  it("applies on a fresh database through the full migration chain", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

    expectNullableFitColumns(sqlite);
    sqlite
      .prepare("INSERT INTO contacts (id, name) VALUES ('fresh-1', 'Fresh Contact')")
      .run();
    expect(
      sqlite
        .prepare("SELECT fit_score, fit_tier, fit_scored_at FROM contacts WHERE id = 'fresh-1'")
        .get(),
    ).toEqual({ fit_score: null, fit_tier: null, fit_scored_at: null });
    sqlite.close();
  });

  it("upgrades an N-1 contacts table additively and preserves existing rows", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE contacts (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        enrichment_score integer DEFAULT 0 NOT NULL,
        tags text DEFAULT '[]',
        metadata text DEFAULT '{}'
      );
      INSERT INTO contacts (id, name, enrichment_score, tags, metadata)
      VALUES ('c-1', 'Existing', 42, '["hackwithbay-4.0"]', '{"agentEnrichment":{"icpScore":81}}');
    `);

    for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }

    expectNullableFitColumns(sqlite);
    expect(sqlite.prepare("SELECT * FROM contacts WHERE id = 'c-1'").get()).toEqual({
      id: "c-1",
      name: "Existing",
      enrichment_score: 42,
      tags: '["hackwithbay-4.0"]',
      metadata: '{"agentEnrichment":{"icpScore":81}}',
      fit_score: null,
      fit_tier: null,
      fit_product: null,
      fit_confidence: null,
      fit_rationale: null,
      fit_score_version: null,
      fit_scored_at: null,
    });
    sqlite.close();
  });
});
