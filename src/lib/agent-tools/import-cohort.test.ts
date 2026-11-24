import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { db } from "@/lib/db/client";
import { contacts, graphEdges } from "@/lib/db/schema";
import { parseStoredContactTags } from "@/lib/agents/tools/enrich-contact";
import { resetCoreTables } from "@/test/db";

// The server side of a multi-identity cohort import (#567): the calls signals-pp-cli makes for
// one row, over the same HTTP envelope.

async function invoke(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

async function ok(tool: string, input: object) {
  const { response, body } = await invoke(tool, input);
  expect(response.status, `${tool}: ${JSON.stringify(body)}`).toBe(200);
  return body.result;
}

function nicheEdges(contactId: string, nicheId: string) {
  return db
    .select()
    .from(graphEdges)
    .all()
    .filter(
      (edge) =>
        edge.edgeType === "belongs_to_niche" &&
        edge.srcType === "contact" &&
        edge.srcId === contactId &&
        edge.dstType === "niche" &&
        edge.dstId === nicheId,
    );
}

describe("cohort import contract (#567)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("query_niches finds a niche by exact id, including a local-only one, and nothing for an unknown id", async () => {
    const shared = await ok("upsert_niche", { name: "HackwithBay 4.0" });
    const local = await ok("upsert_niche", { name: "Private cohort", scope: "local_only" });

    const found = await ok("query_niches", { id: shared.id, includeLocalOnly: true, pageSize: 1 });
    expect(found.niches.map((n: { id: string }) => n.id)).toEqual([shared.id]);

    const foundLocal = await ok("query_niches", { id: local.id, includeLocalOnly: true });
    expect(foundLocal.niches.map((n: { id: string }) => n.id)).toEqual([local.id]);

    const missing = await ok("query_niches", { id: "niche-does-not-exist", includeLocalOnly: true });
    expect(missing).toEqual({ total: 0, niches: [] });
  });

  it("one row's writes: profile fields, a secondary identity with provenance, JSON tags and niche membership; a rerun adds nothing", async () => {
    const niche = await ok("upsert_niche", { name: "HackwithBay 4.0" });

    const writeRow = async () => {
      const created = await ok("create_contact", {
        name: "New Builder",
        platform: "linkedin",
        platformUserId: "new-builder",
        provenance: { kind: "self_declared" },
        bio: "Builds agents",
        headline: "Founder",
        website: "https://builder.dev",
        location: "SF",
      });
      await ok("upsert_contact_identity", {
        contactId: created.id,
        platform: "x",
        platformUserId: "new_builder",
        platformHandle: "@new_builder",
        provenance: { kind: "self_declared", sourceUrl: "https://lu.ma/user/new-builder" },
      });
      await ok("enrich_contact", { contactId: created.id, tags: ["hackwithbay-4", "builder"] });
      await ok("upsert_edge", {
        srcType: "contact",
        srcId: created.id,
        dstType: "niche",
        dstId: niche.id,
        edgeType: "belongs_to_niche",
        source: "import",
      });
      return created.id as string;
    };

    const contactId = await writeRow();
    const rerunId = await writeRow();
    expect(rerunId).toBe(contactId);

    const contact = await ok("get_contact", { contactId });
    expect(contact).toMatchObject({ bio: "Builds agents", headline: "Founder", location: "SF" });
    expect(JSON.parse(contact.tags)).toEqual(["hackwithbay-4", "builder"]);
    const identities = contact.identities as Array<{ platform: string; platformUserId: string; provenance: { kind: string; sourceUrl: string | null } | null }>;
    expect(identities.map((i) => `${i.platform}/${i.platformUserId}`).sort()).toEqual([
      "linkedin/new-builder",
      "x/new_builder",
    ]);
    expect(identities.find((i) => i.platform === "x")?.provenance).toMatchObject({
      kind: "self_declared",
      sourceUrl: "https://lu.ma/user/new-builder",
    });
    expect(nicheEdges(contactId, niche.id)).toHaveLength(1);

    // WP3's cohort query finds it by tag and niche membership.
    const cohort = await ok("query_contacts", { tags: ["hackwithbay-4"], nicheId: niche.id });
    expect(cohort.contacts.map((c: { id: string }) => c.id)).toEqual([contactId]);
  });

  it("enrich_contact merges tags into a legacy non-JSON value instead of failing, and rewrites it as a JSON array", async () => {
    const created = await ok("create_contact", { name: "Legacy Tags" });
    db.update(contacts).set({ tags: "vip, judge" }).where(eq(contacts.id, created.id)).run();

    const result = await ok("enrich_contact", { contactId: created.id, tags: ["hackwithbay-4", "vip"] });
    expect(result.fieldsUpdated).toContain("tags");
    const stored = db.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, created.id)).get();
    expect(JSON.parse(stored!.tags!)).toEqual(["vip", "judge", "hackwithbay-4"]);

    const cohort = await ok("query_contacts", { tags: ["judge", "hackwithbay-4"] });
    expect(cohort.contacts.map((c: { id: string }) => c.id)).toEqual([created.id]);
  });

  it("parseStoredContactTags reads JSON arrays, JSON strings, comma lists and empty values", () => {
    expect(parseStoredContactTags('["a","b"]')).toEqual(["a", "b"]);
    expect(parseStoredContactTags('"a, b"')).toEqual(["a", "b"]);
    expect(parseStoredContactTags("a, b,,a")).toEqual(["a", "b"]);
    expect(parseStoredContactTags("")).toEqual([]);
    expect(parseStoredContactTags(null)).toEqual([]);
    expect(parseStoredContactTags('[1, "x", ""]')).toEqual(["x"]);
  });
});
