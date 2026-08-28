import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const MIGRATION_SQL = readFileSync(
  new URL("./migrations/0035_tiny_microchip.sql", import.meta.url),
  "utf8",
);

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

describe("0035 company intelligence migration", () => {
  it("upgrades an N-1 database additively and preserves existing rows", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE contacts (id text PRIMARY KEY NOT NULL, name text NOT NULL);
      CREATE TABLE orgs (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        domain text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE TABLE tasks (
        id text PRIMARY KEY NOT NULL,
        title text NOT NULL,
        related_contact_id text REFERENCES contacts(id),
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      INSERT INTO orgs VALUES ('org-1', 'Acme', 'acme.example', 1, 1);
      INSERT INTO tasks VALUES ('task-1', 'Follow up', NULL, 1, 1);
    `);

    for (const statement of MIGRATION_SQL.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }

    expect(columns(sqlite, "orgs")).toEqual(
      expect.arrayContaining([
        "industry",
        "company_size",
        "tags",
        "owner_contact_id",
        "account_stage",
        "followed_at",
        "feed_seen_at",
      ]),
    );
    expect(columns(sqlite, "tasks")).toContain("related_org_id");
    for (const table of [
      "org_domains",
      "org_email_patterns",
      "contact_email_candidates",
      "org_activities",
    ]) {
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
      ).toBeTruthy();
    }
    expect(sqlite.prepare("SELECT name, domain FROM orgs WHERE id='org-1'").get()).toEqual({
      name: "Acme",
      domain: "acme.example",
    });
    expect(sqlite.prepare("SELECT title FROM tasks WHERE id='task-1'").get()).toEqual({
      title: "Follow up",
    });
    sqlite.close();
  });
});
