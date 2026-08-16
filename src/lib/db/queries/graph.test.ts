import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createContact } from "@/lib/db/queries/contacts";
import {
  defaultScopeForEdgeType,
  getNeighbors,
  queryGraphEdges,
  serializeGraphEdge,
  upsertGraphEdge,
  validateEdgeEndpoints,
} from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import { graphEdges, orgs } from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrate";
import { resetCoreTables } from "@/test/db";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

function applyMigrationFiles(sqlite: Database.Database, files: string[]) {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split(/--> statement-breakpoint\n?/)) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

function listMigrationSqlFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

describe("graph queries", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("defaults relationship edges to local_only scope", () => {
    expect(defaultScopeForEdgeType("relationship")).toBe("local_only");
    expect(defaultScopeForEdgeType("works_at")).toBe("shared");
  });

  it("upserts edges by natural key and bumps last_seen_at", () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "a1" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "b1" });

    const first = upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "follows",
      properties: '{"platform":"x"}',
      source: "test",
    });

    const second = upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "follows",
      weight: 42,
      source: "test",
    });

    expect(second.id).toBe(first.id);
    expect(second.weight).toBe(42);
    expect(second.lastSeenAt).toBeGreaterThanOrEqual(first.lastSeenAt);
    expect(db.select().from(graphEdges).all()).toHaveLength(1);
  });

  it("returns 1-hop neighbors with direction filter", () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "a2" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "b2" });
    const carol = createContact({ name: "Carol", platform: "x", platformUserId: "c2" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: carol.id,
      dstType: "contact",
      dstId: alice.id,
      edgeType: "follows",
    });

    const outgoing = getNeighbors("contact", alice.id, { direction: "outgoing" });
    const incoming = getNeighbors("contact", alice.id, { direction: "incoming" });

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.dstId).toBe(bob.id);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.srcId).toBe(carol.id);
  });

  it("rejects edges when endpoints are missing", () => {
    expect(() =>
      validateEdgeEndpoints("contact", "missing", "contact", "also-missing"),
    ).toThrow(/source not found/);
  });

  it("filters local_only edges unless includeLocalOnly is set", () => {
    const alice = createContact({ name: "Alice", platform: "x", platformUserId: "a3" });
    const bob = createContact({ name: "Bob", platform: "x", platformUserId: "b3" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: alice.id,
      dstType: "contact",
      dstId: bob.id,
      edgeType: "relationship",
      propertiesPrivate: '{"private_notes":"secret dinner plans"}',
    });

    const publicView = queryGraphEdges({
      srcType: "contact",
      srcId: alice.id,
      edgeTypes: ["relationship"],
    });
    const privateView = queryGraphEdges({
      srcType: "contact",
      srcId: alice.id,
      edgeTypes: ["relationship"],
      includeLocalOnly: true,
    });

    expect(publicView).toHaveLength(0);
    expect(privateView).toHaveLength(1);
    expect(privateView[0]?.propertiesPrivate).toBe('{"private_notes":"secret dinner plans"}');
  });

  it("never serializes properties_private without includeLocalOnly", () => {
    const edge = db
      .insert(graphEdges)
      .values({
        id: nanoid(),
        srcType: "contact",
        srcId: "c1",
        dstType: "contact",
        dstId: "c2",
        edgeType: "relationship",
        scope: "local_only",
        propertiesPrivate: '{"private_notes":"do not leak"}',
      })
      .returning()
      .get();

    const serialized = serializeGraphEdge(edge!);
    expect(serialized).not.toHaveProperty("propertiesPrivate");
    expect(JSON.stringify(serialized)).not.toContain("do not leak");
  });
});

describe("schema v0.5 migrations", () => {
  it("creates graph and explore-card tables on empty database", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-empty-"));
    runMigrations(dir);

    const sqlite = new Database(join(dir, "data.db"));
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("orgs");
    expect(tables).toContain("graph_edges");
    expect(tables).toContain("interactions");
    expect(tables).toContain("identity_metrics");
    expect(tables).toContain("contact_personas");
    expect(tables).toContain("org_identities");
    expect(tables).toContain("org_identity_metrics");

    const columns = sqlite
      .prepare("PRAGMA table_info(contacts)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toContain("is_self");
    sqlite.close();
  });

  it("applies 0016 additively for N-1 databases (is_self column absent before upgrade)", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-n-1-is-self-"));
    const dbPath = join(dir, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    const migrationFiles = listMigrationSqlFiles();
    const pre0016 = migrationFiles.filter((file) => !file.startsWith("0016_"));
    applyMigrationFiles(sqlite, pre0016);

    const columnsBefore = sqlite
      .prepare("PRAGMA table_info(contacts)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columnsBefore).not.toContain("is_self");

    const contactId = nanoid();
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, funnel_stage, score, enrichment_score, verified_email, created_at, updated_at) VALUES (?, ?, 'prospect', 0, 0, 0, 1, 1)",
      )
      .run(contactId, "Legacy Contact");

    applyMigrationFiles(
      sqlite,
      migrationFiles.filter((file) => file.startsWith("0016_")),
    );

    const columnsAfter = sqlite
      .prepare("PRAGMA table_info(contacts)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columnsAfter).toContain("is_self");
    expect(sqlite.prepare("SELECT name FROM contacts WHERE id = ?").get(contactId)).toEqual({
      name: "Legacy Contact",
    });
    sqlite.close();
  });

  it("applies 0012 additively for N-1 databases (new tables invisible before upgrade)", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-n-1-org-identities-"));
    const dbPath = join(dir, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    const migrationFiles = listMigrationSqlFiles();
    const pre0012 = migrationFiles.filter((file) => !file.startsWith("0012_"));
    applyMigrationFiles(sqlite, pre0012);

    const tablesBefore = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tablesBefore).not.toContain("org_identities");
    expect(tablesBefore).not.toContain("org_identity_metrics");

    const orgId = nanoid();
    sqlite.prepare("INSERT INTO orgs (id, name) VALUES (?, ?)").run(orgId, "Legacy Org");
    expect(sqlite.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId)).toEqual({
      name: "Legacy Org",
    });

    applyMigrationFiles(
      sqlite,
      migrationFiles.filter((file) => file.startsWith("0012_")),
    );

    const tablesAfter = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tablesAfter).toContain("org_identities");
    expect(tablesAfter).toContain("org_identity_metrics");
    expect(sqlite.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId)).toEqual({
      name: "Legacy Org",
    });
    sqlite.close();
    expect(dbPath).toBeTruthy();
  });

  it("is idempotent when migrations run twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-idempotent-"));
    runMigrations(dir);
    expect(() => runMigrations(dir)).not.toThrow();

    const sqlite = new Database(join(dir, "data.db"));
    const orgId = nanoid();
    sqlite
      .prepare("INSERT INTO orgs (id, name) VALUES (?, ?)")
      .run(orgId, "Acme Corp");
    const row = sqlite.prepare("SELECT name FROM orgs WHERE id = ?").get(orgId) as { name: string };
    expect(row.name).toBe("Acme Corp");
    sqlite.close();
  });
});
