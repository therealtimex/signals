import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  applyMigrationFiles,
  columnExists,
  listMigrationSqlFiles,
} from "@/lib/db/migration-utils";
import { resetCoreTables } from "@/test/db";

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
    expect(columns).not.toContain("company");
    expect(columns).not.toContain("title");
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("phone");
    expect(columns).not.toContain("platform");
    expect(columns).not.toContain("platform_user_id");
    expect(columns).not.toContain("verified_email");

    const mediaAssetColumns = sqlite
      .prepare("PRAGMA table_info(media_assets)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(mediaAssetColumns).not.toContain("content_item_id");
    expect(mediaAssetColumns).not.toContain("platform_target");

    const contentItemColumns = sqlite
      .prepare("PRAGMA table_info(content_items)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(contentItemColumns).not.toContain("media_paths");
    sqlite.close();
  });

  it("drops company/title on P2d migration while preserving employments", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-p2d-"));
    const dbPath = join(dir, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    const migrationFiles = listMigrationSqlFiles();
    const through0018 = migrationFiles.filter((file) => !file.startsWith("0019_drop"));
    applyMigrationFiles(sqlite, through0018);

    const contactId = nanoid();
    const employmentId = nanoid();
    const orgId = nanoid();
    sqlite
      .prepare("INSERT INTO orgs (id, name, scope, source) VALUES (?, ?, 'shared', 'test')")
      .run(orgId, "Acme Corp");
    sqlite
      .prepare(
        `INSERT INTO contacts (
          id, name, funnel_stage, score, enrichment_score, created_at, updated_at
        ) VALUES (?, ?, 'prospect', 0, 0, 1, 1)`,
      )
      .run(contactId, "Worker");
    sqlite
      .prepare(
        `INSERT INTO contact_employments (
          id, contact_id, org_id, title, is_current, scope, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'shared', 'test', 1, 1)`,
      )
      .run(employmentId, contactId, orgId, "CEO");

    applyMigrationFiles(
      sqlite,
      migrationFiles.filter((file) => file.startsWith("0019_drop")),
    );
    sqlite.close();

    const upgraded = new Database(dbPath);
    const columns = upgraded
      .prepare("PRAGMA table_info(contacts)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).not.toContain("company");
    expect(columns).not.toContain("title");
    expect(columnExists(upgraded, "contacts", "company")).toBe(false);
    expect(
      upgraded.prepare("SELECT COUNT(*) AS count FROM contact_employments").get(),
    ).toEqual({ count: 1 });
    upgraded.close();
  });

  it("drops legacy media columns on P3e while preserving junction-linked assets", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-p3e-"));
    const dbPath = join(dir, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    const migrationFiles = listMigrationSqlFiles();
    const through0020 = migrationFiles.filter((file) => !file.startsWith("0021_drop"));
    applyMigrationFiles(sqlite, through0020);

    const contentItemId = nanoid();
    const assetId = nanoid();
    const attachmentId = nanoid();
    sqlite
      .prepare(
        `INSERT INTO content_items (
          id, content_type, status, media_paths, created_at, updated_at
        ) VALUES (?, 'post', 'draft', ?, 1, 1)`,
      )
      .run(contentItemId, JSON.stringify([assetId]));
    sqlite
      .prepare(
        `INSERT INTO media_assets (
          id, filename, storage_path, mime_type, file_size, origin, scope,
          content_item_id, platform_target, created_at, updated_at
        ) VALUES (?, 'deck.pdf', 'deck.pdf', 'application/pdf', 100, 'upload', 'shared', ?, 'linkedin', 1, 1)`,
      )
      .run(assetId, contentItemId);
    sqlite
      .prepare(
        `INSERT INTO media_attachments (
          id, media_asset_id, parent_type, parent_id, role, sort_order, source, created_at, updated_at
        ) VALUES (?, ?, 'content_item', ?, 'attachment', 0, 'test', 1, 1)`,
      )
      .run(attachmentId, assetId, contentItemId);

    applyMigrationFiles(
      sqlite,
      migrationFiles.filter((file) => file.startsWith("0021_drop")),
    );
    sqlite.close();

    const upgraded = new Database(dbPath);
    expect(columnExists(upgraded, "media_assets", "content_item_id")).toBe(false);
    expect(columnExists(upgraded, "media_assets", "platform_target")).toBe(false);
    expect(columnExists(upgraded, "content_items", "media_paths")).toBe(false);
    expect(
      upgraded.prepare("SELECT COUNT(*) AS count FROM media_assets").get(),
    ).toEqual({ count: 1 });
    expect(
      upgraded.prepare("SELECT COUNT(*) AS count FROM media_attachments").get(),
    ).toEqual({ count: 1 });
    upgraded.close();
  });

  it("drops channel/platform scalars on P1e while preserving channel rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "signals-migrate-p1e-"));
    const dbPath = join(dir, "data.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    const migrationFiles = listMigrationSqlFiles();
    const through0021 = migrationFiles.filter((file) => !file.startsWith("0022_drop"));
    applyMigrationFiles(sqlite, through0021);

    const contactId = nanoid();
    const channelId = nanoid();
    sqlite
      .prepare(
        `INSERT INTO contacts (
          id, name, email, phone, platform, platform_user_id, verified_email,
          funnel_stage, score, enrichment_score, created_at, updated_at
        ) VALUES (?, 'Reachable', 'ada@example.com', '+15550100', 'x', 'ada-x', 1, 'prospect', 0, 0, 1, 1)`,
      )
      .run(contactId);
    sqlite
      .prepare(
        `INSERT INTO contact_channels (
          id, contact_id, channel_type, value, value_normalized, is_primary, is_verified,
          scope, source, created_at, updated_at
        ) VALUES (?, ?, 'email', 'ada@example.com', 'ada@example.com', 1, 1, 'shared', 'test', 1, 1)`,
      )
      .run(channelId, contactId);

    applyMigrationFiles(
      sqlite,
      migrationFiles.filter((file) => file.startsWith("0022_drop")),
    );
    sqlite.close();

    const upgraded = new Database(dbPath);
    expect(columnExists(upgraded, "contacts", "email")).toBe(false);
    expect(columnExists(upgraded, "contacts", "phone")).toBe(false);
    expect(columnExists(upgraded, "contacts", "platform")).toBe(false);
    expect(columnExists(upgraded, "contacts", "platform_user_id")).toBe(false);
    expect(columnExists(upgraded, "contacts", "verified_email")).toBe(false);
    expect(
      upgraded.prepare("SELECT COUNT(*) AS count FROM contact_channels").get(),
    ).toEqual({ count: 1 });
    upgraded.close();
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
        "INSERT INTO contacts (id, name, funnel_stage, score, enrichment_score, created_at, updated_at) VALUES (?, ?, 'prospect', 0, 0, 1, 1)",
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
