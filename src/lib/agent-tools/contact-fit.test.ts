import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AGENT_TOOLS } from "@/lib/agent-tools/registry";
import { CONTACT_FIT_BATCH_MAX } from "@/lib/agent-tools/schemas";
import { createContact, getContactById, updateContact } from "@/lib/db/queries/contacts";
import { upsertNiche } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { resetCoreTables } from "@/test/db";

type QueriedContact = {
  id: string;
  name: string;
  fitScore: number | null;
  fitTier: string | null;
  fitProduct: string | null;
  fitConfidence: number | null;
  fitRationale: string | null;
  fitScoreVersion: string | null;
  fitScoredAt: number | null;
};

type ScoreResult = {
  fitScoredAt: number;
  summary: { total: number; ok: number; skipped: number; error: number };
  results: Array<{
    index: number;
    contactId: string | null;
    status: "ok" | "skipped" | "error";
    reason?: string;
    message?: string;
    mergedIntoContactId?: string;
    fitScoredAt?: number;
  }>;
};

async function score(input: object): Promise<ScoreResult> {
  return (await invokeAgentTool("score_contact_fit", input)) as ScoreResult;
}

async function query(input: object = {}): Promise<{ total: number; contacts: QueriedContact[] }> {
  return (await invokeAgentTool("query_contacts", input)) as {
    total: number;
    contacts: QueriedContact[];
  };
}

async function getContact(contactId: string): Promise<QueriedContact & { tags: string | null }> {
  return (await invokeAgentTool("get_contact", { contactId })) as QueriedContact & {
    tags: string | null;
  };
}

async function invokeHttp(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { response, body: await response.json() };
}

function contact(name: string, tags: string[] = []) {
  return createContact({ name, tags: JSON.stringify(tags) });
}

function joinNiche(contactId: string, nicheId: string) {
  upsertGraphEdge({
    srcType: "contact",
    srcId: contactId,
    dstType: "niche",
    dstId: nicheId,
    edgeType: "belongs_to_niche",
  });
}

function names(result: { contacts: QueriedContact[] }) {
  return result.contacts.map((row) => row.name);
}

describe("score_contact_fit", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("is registered with a strict advertised row schema", () => {
    const definition = AGENT_TOOLS.score_contact_fit;
    expect(definition.category).toBe("contacts");
    const parameters = definition.parameters as {
      required?: string[];
      properties: {
        items: {
          description: string;
          items: { required: string[]; properties: Record<string, Record<string, unknown>> };
        };
      };
    };
    expect(parameters.required).toEqual(["items"]);
    expect(parameters.properties.items.description).toContain(`1–${CONTACT_FIT_BATCH_MAX} rows`);
    expect(parameters.properties.items.items.required).toEqual(
      expect.arrayContaining(["contactId", "fitScore", "fitTier"]),
    );
    expect(parameters.properties.items.items.properties.fitTier.enum).toEqual([
      "A",
      "B",
      "C",
      "unknown",
    ]);
  });

  it("writes every fit field, sets fitScoredAt server-side, and reads back through get_contact and query_contacts", async () => {
    const ada = contact("Ada");
    const before = Math.floor(Date.now() / 1000);

    const result = await score({
      fitScoreVersion: "icp-rubric-v2",
      items: [
        {
          contactId: ada.id,
          fitScore: 87,
          fitTier: "A",
          fitProduct: "realtimex-desktop",
          fitConfidence: 0.8,
          fitRationale: "Runs a 40-person agency automating client ops.",
        },
      ],
    });

    expect(result.summary).toEqual({ total: 1, ok: 1, skipped: 0, error: 0 });
    expect(result.results[0]).toMatchObject({ index: 0, contactId: ada.id, status: "ok" });
    expect(result.fitScoredAt).toBeGreaterThanOrEqual(before);

    const expected = {
      fitScore: 87,
      fitTier: "A",
      fitProduct: "realtimex-desktop",
      fitConfidence: 0.8,
      fitRationale: "Runs a 40-person agency automating client ops.",
      fitScoreVersion: "icp-rubric-v2",
      fitScoredAt: result.fitScoredAt,
    };
    expect(await getContact(ada.id)).toMatchObject(expected);
    const listed = await query();
    expect(listed.contacts.find((row) => row.id === ada.id)).toMatchObject(expected);
  });

  it("returns null fit fields for an unscored contact", async () => {
    const bob = contact("Bob");
    const nulls = {
      fitScore: null,
      fitTier: null,
      fitProduct: null,
      fitConfidence: null,
      fitRationale: null,
      fitScoreVersion: null,
      fitScoredAt: null,
    };
    expect(await getContact(bob.id)).toMatchObject(nulls);
    expect((await query()).contacts[0]).toMatchObject(nulls);
  });

  it("rescoring overwrites all fit fields, clearing omitted optional ones", async () => {
    const ada = contact("Ada");
    await score({
      items: [
        {
          contactId: ada.id,
          fitScore: 40,
          fitTier: "C",
          fitProduct: "signals-crm",
          fitConfidence: 0.3,
          fitRationale: "Thin profile.",
          fitScoreVersion: "v1",
        },
      ],
    });

    const second = await score({ items: [{ contactId: ada.id, fitScore: 91, fitTier: "A" }] });

    expect(second.summary.ok).toBe(1);
    expect(await getContact(ada.id)).toMatchObject({
      fitScore: 91,
      fitTier: "A",
      fitProduct: null,
      fitConfidence: null,
      fitRationale: null,
      fitScoreVersion: null,
      fitScoredAt: second.fitScoredAt,
    });
  });

  it("lets a row override the batch-level fitScoreVersion", async () => {
    const ada = contact("Ada");
    const bob = contact("Bob");

    await score({
      fitScoreVersion: "batch-v3",
      items: [
        { contactId: ada.id, fitScore: 70, fitTier: "B" },
        { contactId: bob.id, fitScore: 20, fitTier: "C", fitScoreVersion: "row-v4" },
      ],
    });

    expect((await getContact(ada.id)).fitScoreVersion).toBe("batch-v3");
    expect((await getContact(bob.id)).fitScoreVersion).toBe("row-v4");
  });

  it("reports an unknown contactId as a not_found row and writes nothing for it", async () => {
    const result = await score({
      items: [{ contactId: "missing-contact", fitScore: 50, fitTier: "B" }],
    });

    expect(result.summary).toEqual({ total: 1, ok: 0, skipped: 0, error: 1 });
    expect(result.results[0]).toMatchObject({
      index: 0,
      contactId: "missing-contact",
      status: "error",
      reason: "not_found",
    });
    expect(getContactById("missing-contact")).toBeUndefined();
  });

  it("keeps writing valid rows when other rows are invalid, missing, duplicated, or out of scope", async () => {
    const good = contact("Good");
    const alsoGood = contact("Also Good");
    const self = createContact({ name: "Operator", isSelf: true });
    const archived = contact("Archived");
    updateContact(archived.id, { metadata: JSON.stringify({ archived: 1 }) });
    const merged = contact("Merged");
    updateContact(merged.id, {
      metadata: JSON.stringify({ archived: 1, mergedIntoContactId: good.id }),
    });
    const actor = contact("Platform Actor");
    updateContact(actor.id, { metadata: JSON.stringify({ platformActor: 1 }) });

    const result = await score({
      items: [
        { contactId: good.id, fitScore: 88, fitTier: "A" },
        { contactId: alsoGood.id, fitScore: 150, fitTier: "A" },
        { contactId: alsoGood.id, fitScore: 55, fitTier: "Z" },
        { fitScore: 10, fitTier: "C" },
        "not-an-object",
        { contactId: "missing", fitScore: 10, fitTier: "C" },
        { contactId: self.id, fitScore: 99, fitTier: "A" },
        { contactId: archived.id, fitScore: 60, fitTier: "B" },
        { contactId: merged.id, fitScore: 60, fitTier: "B" },
        { contactId: actor.id, fitScore: 60, fitTier: "B" },
        { contactId: alsoGood.id, fitScore: 64, fitTier: "B", fitRationale: "x".repeat(2_001) },
        { contactId: alsoGood.id, fitScore: 64, fitTier: "B" },
        { contactId: good.id, fitScore: 1, fitTier: "C" },
      ],
    });

    expect(result.summary).toEqual({ total: 13, ok: 2, skipped: 4, error: 7 });
    const byIndex = result.results.map((row) => [row.index, row.status, row.reason ?? null]);
    expect(byIndex).toEqual([
      [0, "ok", null],
      [1, "error", "invalid_input"],
      [2, "error", "invalid_input"],
      [3, "error", "invalid_input"],
      [4, "error", "invalid_input"],
      [5, "error", "not_found"],
      [6, "skipped", "self"],
      [7, "skipped", "archived"],
      [8, "skipped", "archived"],
      [9, "skipped", "platform_actor"],
      [10, "error", "invalid_input"],
      [11, "ok", null],
      [12, "error", "duplicate_in_batch"],
    ]);
    expect(result.results[1].message).toContain("fitScore");
    expect(result.results[2].message).toContain("fitTier");
    expect(result.results[3].contactId).toBeNull();
    expect(result.results[8].mergedIntoContactId).toBe(good.id);

    expect(await getContact(good.id)).toMatchObject({ fitScore: 88, fitTier: "A" });
    expect(await getContact(alsoGood.id)).toMatchObject({ fitScore: 64, fitTier: "B" });
    for (const untouched of [self.id, archived.id, merged.id, actor.id]) {
      expect(getContactById(untouched)?.fitScore).toBeNull();
    }
  });

  it("rejects a malformed request envelope as a 400 validation error", async () => {
    const empty = await invokeHttp("score_contact_fit", { items: [] });
    expect(empty.response.status).toBe(400);
    expect(empty.body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });

    const missing = await invokeHttp("score_contact_fit", {});
    expect(missing.response.status).toBe(400);

    const tooMany = await invokeHttp("score_contact_fit", {
      items: Array.from({ length: CONTACT_FIT_BATCH_MAX + 1 }, (_, i) => ({
        contactId: `c-${i}`,
        fitScore: 50,
        fitTier: "B",
      })),
    });
    expect(tooMany.response.status).toBe(400);
  });

  it("returns per-row results inside a success envelope over HTTP", async () => {
    const ada = contact("Ada");
    const { response, body } = await invokeHttp("score_contact_fit", {
      items: [
        { contactId: ada.id, fitScore: 75, fitTier: "B" },
        { contactId: "missing", fitScore: 75, fitTier: "B" },
      ],
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.summary).toEqual({ total: 2, ok: 1, skipped: 0, error: 1 });
  });
});

describe("query_contacts tag, niche and fit filters", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  async function seedCohort() {
    const niche = upsertNiche({ name: "HackwithBay 4.0" });
    const otherNiche = upsertNiche({ name: "Other Cohort" });
    const ada = contact("Ada", ["hackwithbay-4.0", "icp-tier-a"]);
    const bob = contact("Bob", ["hackwithbay-4.0"]);
    const cy = contact("Cy", ["hackwithbay-4.0", "icp-tier-a"]);
    const dee = contact("Dee", ["unrelated"]);
    const eve = contact("Eve", ["hackwithbay-4.0"]);
    joinNiche(ada.id, niche.id);
    joinNiche(bob.id, niche.id);
    joinNiche(cy.id, niche.id);
    joinNiche(eve.id, niche.id);
    joinNiche(dee.id, otherNiche.id);
    await score({
      items: [
        { contactId: ada.id, fitScore: 92, fitTier: "A" },
        { contactId: bob.id, fitScore: 55, fitTier: "B" },
        { contactId: cy.id, fitScore: 71, fitTier: "A" },
        { contactId: dee.id, fitScore: 95, fitTier: "A" },
      ],
    });
    return { niche, otherNiche, ada, bob, cy, dee, eve };
  }

  it("filters by a single tag and requires every listed tag", async () => {
    await seedCohort();

    expect(names(await query({ tags: ["hackwithbay-4.0"] })).sort()).toEqual([
      "Ada",
      "Bob",
      "Cy",
      "Eve",
    ]);
    expect(names(await query({ tags: ["hackwithbay-4.0", "icp-tier-a"] })).sort()).toEqual([
      "Ada",
      "Cy",
    ]);
    expect((await query({ tags: ["HACKWITHBAY-4.0"] })).total).toBe(0);
  });

  it("ignores contacts whose tags column is not a JSON array instead of failing", async () => {
    await seedCohort();
    const broken = contact("Broken");
    updateContact(broken.id, { tags: "not json" });
    const scalar = contact("Scalar");
    updateContact(scalar.id, { tags: '"hackwithbay-4.0"' });

    const result = await query({ tags: ["hackwithbay-4.0"] });

    expect(result.total).toBe(4);
    expect(names(result)).not.toContain("Broken");
    expect(names(result)).not.toContain("Scalar");
  });

  it("filters by niche membership through belongs_to_niche edges", async () => {
    const { niche, otherNiche } = await seedCohort();

    expect(names(await query({ nicheId: niche.id })).sort()).toEqual(["Ada", "Bob", "Cy", "Eve"]);
    expect(names(await query({ nicheId: otherNiche.id }))).toEqual(["Dee"]);
    expect((await query({ nicheId: "no-such-niche" })).total).toBe(0);
  });

  it("filters by fitTier and by inclusive minFitScore, excluding unscored contacts", async () => {
    await seedCohort();

    expect(names(await query({ fitTier: "A" })).sort()).toEqual(["Ada", "Cy", "Dee"]);
    expect(names(await query({ minFitScore: 71 })).sort()).toEqual(["Ada", "Cy", "Dee"]);
    expect(names(await query({ minFitScore: 0 }))).not.toContain("Eve");
  });

  it("sorts by fitScore descending by default with unscored contacts last", async () => {
    await seedCohort();
    createContact({ name: "Operator", isSelf: true });

    const descending = names(await query({ sort: "fitScore" }));
    expect(descending.slice(0, 4)).toEqual(["Dee", "Ada", "Cy", "Bob"]);
    // Unscored rows trail, and the self contact is not pinned ahead of them.
    expect(descending.slice(4).sort()).toEqual(["Eve", "Operator"]);
    const ascending = names(await query({ sort: "fitScore", order: "asc" }));
    expect(ascending.slice(0, 4)).toEqual(["Bob", "Cy", "Ada", "Dee"]);
    expect(ascending.slice(4).sort()).toEqual(["Eve", "Operator"]);
  });

  it("pages a fitScore sort deterministically", async () => {
    await seedCohort();

    const first = await query({ sort: "fitScore", pageSize: 2, page: 1 });
    const second = await query({ sort: "fitScore", pageSize: 2, page: 2 });

    expect(first.total).toBe(5);
    expect(names(first)).toEqual(["Dee", "Ada"]);
    expect(names(second)).toEqual(["Cy", "Bob"]);
  });

  it("combines tags, nicheId, fitTier, minFitScore and the fitScore sort", async () => {
    const { niche } = await seedCohort();

    const tierA = await query({
      tags: ["hackwithbay-4.0"],
      nicheId: niche.id,
      fitTier: "A",
      sort: "fitScore",
    });
    expect(names(tierA)).toEqual(["Ada", "Cy"]);
    expect(tierA.contacts[0]).toMatchObject({ fitScore: 92, fitTier: "A" });

    const strong = await query({
      tags: ["hackwithbay-4.0", "icp-tier-a"],
      nicheId: niche.id,
      fitTier: "A",
      minFitScore: 80,
      sort: "fitScore",
    });
    expect(names(strong)).toEqual(["Ada"]);
    expect(strong.total).toBe(1);

    // Dee is a 95/A but neither tagged nor in this niche.
    expect(names(await query({ nicheId: niche.id, minFitScore: 90 }))).toEqual(["Ada"]);
  });

  it("leaves existing callers' default ordering unchanged (self pinned, newest first)", async () => {
    await seedCohort();
    const self = createContact({ name: "Operator", isSelf: true });

    const result = await query();

    expect(result.total).toBe(6);
    expect(result.contacts[0].id).toBe(self.id);
  });

  it("validates the new filters", async () => {
    const outOfRange = await invokeHttp("query_contacts", { minFitScore: 101 });
    expect(outOfRange.response.status).toBe(400);
    const badTier = await invokeHttp("query_contacts", { fitTier: "D" });
    expect(badTier.response.status).toBe(400);
    const emptyTags = await invokeHttp("query_contacts", { tags: [] });
    expect(emptyTags.response.status).toBe(400);
    const badSort = await invokeHttp("query_contacts", { sort: "icpScore" });
    expect(badSort.response.status).toBe(400);
  });
});
