import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const MIGRATION_SQL = readFileSync(
  new URL("./migrations/0040_identity_provenance_aliases.sql", import.meta.url),
  "utf8",
);

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown };

function columns(sqlite: Database.Database, table: string): Map<string, ColumnInfo> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

function expectNullableColumns(
  sqlite: Database.Database,
  table: string,
  expected: Record<string, string>,
) {
  const actual = columns(sqlite, table);
  for (const [name, type] of Object.entries(expected)) {
    const column = actual.get(name);
    expect(column, `${table}.${name}`).toBeDefined();
    expect(column?.type.toUpperCase(), `${table}.${name}`).toBe(type);
    expect(column?.notnull, `${table}.${name}`).toBe(0);
    expect(column?.dflt_value, `${table}.${name}`).toBeNull();
  }
}

const IDENTITY_COLUMNS = {
  provenance_kind: "TEXT",
  provenance_source_url: "TEXT",
  provenance_observed_at: "INTEGER",
};

function applyMigration(sqlite: Database.Database) {
  for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

describe("0040 identity provenance + contact aliases migration", () => {
  it("applies on a fresh database through the full migration chain", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR });

    expectNullableColumns(sqlite, "contact_identities", IDENTITY_COLUMNS);
    expectNullableColumns(sqlite, "contacts", { aliases: "TEXT" });
    sqlite.exec(`
      INSERT INTO contacts (id, name) VALUES ('c-fresh', 'Fresh');
      INSERT INTO contact_identities (id, contact_id, platform, platform_user_id)
      VALUES ('i-fresh', 'c-fresh', 'linkedin', 'fresh-person');
    `);
    expect(
      sqlite
        .prepare(
          "SELECT provenance_kind, provenance_source_url, provenance_observed_at FROM contact_identities WHERE id = 'i-fresh'",
        )
        .get(),
    ).toEqual({ provenance_kind: null, provenance_source_url: null, provenance_observed_at: null });
    expect(sqlite.prepare("SELECT aliases FROM contacts WHERE id = 'c-fresh'").get()).toEqual({
      aliases: null,
    });
    sqlite.close();
  });

  it("upgrades an N-1 database additively and leaves existing identities' provenance unknown (null)", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE contacts (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        fit_score integer
      );
      CREATE TABLE contact_identities (
        id text PRIMARY KEY NOT NULL,
        contact_id text NOT NULL REFERENCES contacts(id) ON DELETE cascade,
        platform text NOT NULL,
        platform_user_id text NOT NULL,
        platform_url text
      );
      INSERT INTO contacts VALUES ('c-1', 'Sas P', 88);
      INSERT INTO contact_identities VALUES
        ('i-1', 'c-1', 'linkedin', 'sasmita-s', 'https://www.linkedin.com/in/sasmita-s');
    `);

    applyMigration(sqlite);

    expectNullableColumns(sqlite, "contact_identities", IDENTITY_COLUMNS);
    expectNullableColumns(sqlite, "contacts", { aliases: "TEXT" });
    expect(sqlite.prepare("SELECT * FROM contact_identities WHERE id = 'i-1'").get()).toEqual({
      id: "i-1",
      contact_id: "c-1",
      platform: "linkedin",
      platform_user_id: "sasmita-s",
      platform_url: "https://www.linkedin.com/in/sasmita-s",
      provenance_kind: null,
      provenance_source_url: null,
      provenance_observed_at: null,
    });
    expect(sqlite.prepare("SELECT * FROM contacts WHERE id = 'c-1'").get()).toEqual({
      id: "c-1",
      name: "Sas P",
      fit_score: 88,
      aliases: null,
    });
    sqlite.close();
  });
});
