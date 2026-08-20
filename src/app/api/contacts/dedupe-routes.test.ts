import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as scanRoute } from "@/app/api/contacts/dedupe/scan/route";
import { POST as mergeRoute } from "@/app/api/contacts/dedupe/merge/route";
import { db } from "@/lib/db/client";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { getWorkflowRun, listWorkflowSteps } from "@/lib/db/queries/workflows";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { contacts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedSharedEmailPair(): { primaryId: string; secondaryId: string } {
  const rich = createContact({ name: "Sam Altman" });
  const thin = createContact({ name: "Samuel A." });
  for (const contact of [rich, thin]) {
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "sam@openai.com",
      source: "test",
    });
  }
  db.update(contacts).set({ enrichmentScore: 80 }).where(eq(contacts.id, rich.id)).run();
  return { primaryId: rich.id, secondaryId: thin.id };
}

describe("dedupe review API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("scans without an agent and returns hydrated groups", async () => {
    const { primaryId } = seedSharedEmailPair();

    const res = await scanRoute(post("http://localhost/api/contacts/dedupe/scan", { tiers: [1] }));
    expect(res.status).toBe(200);

    const { groups } = await res.json();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryContactId).toBe(primaryId);
    expect(groups[0].members[0].email).toBe("sam@openai.com");
  });

  it("rejects an out-of-range confidence", async () => {
    const res = await scanRoute(
      post("http://localhost/api/contacts/dedupe/scan", { minConfidence: 7 })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe("validation_error");
  });

  it("merges a reviewed group and records it as a run", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();

    const res = await mergeRoute(
      post("http://localhost/api/contacts/dedupe/merge", {
        groups: [{ primaryContactId: primaryId, secondaryContactIds: [secondaryId] }],
      })
    );
    expect(res.status).toBe(200);

    const result = await res.json();
    expect(result.merged).toBe(1);
    expect(result.groups[0].result.merged).toEqual([
      expect.objectContaining({ contactId: secondaryId, status: "merged" }),
    ]);
    expect(getContactById(primaryId)).toBeDefined();

    // The panel does its own work, but it reports like the pipeline does: a prune run in
    // the Runs tab, one contact_merge step per group, and no terminal session attached.
    const run = getWorkflowRun(result.workflowRunId)!;
    expect(run.workflowType).toBe("prune");
    expect(run.status).toBe("completed");
    expect(run.successItems).toBe(1);
    const steps = listWorkflowSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepType).toBe("contact_merge");
    expect(steps[0].tool).toBe("merge_contacts");
  });

  it("leaves no run behind for a dry run", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();

    const res = await mergeRoute(
      post("http://localhost/api/contacts/dedupe/merge", {
        groups: [{ primaryContactId: primaryId, secondaryContactIds: [secondaryId] }],
        dryRun: true,
      })
    );

    const result = await res.json();
    expect(result.workflowRunId).toBeNull();
    expect(result.groups[0].result.dryRun).toBe(true);
    // Preview only — the secondary carries no merge tombstone.
    expect(getContactById(secondaryId)?.metadata ?? "{}").not.toContain("mergedIntoContactId");
  });

  it("reports a second merge of the same group as already merged", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();
    const body = {
      groups: [{ primaryContactId: primaryId, secondaryContactIds: [secondaryId] }],
    };

    await mergeRoute(post("http://localhost/api/contacts/dedupe/merge", body));
    const res = await mergeRoute(post("http://localhost/api/contacts/dedupe/merge", body));

    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.alreadyMerged).toBe(1);
    expect(result.groups[0].result.merged[0].status).toBe("already_merged");
  });

  it("reports an unknown primary per group without failing the batch", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();

    const res = await mergeRoute(
      post("http://localhost/api/contacts/dedupe/merge", {
        groups: [
          { primaryContactId: "missing", secondaryContactIds: ["also-missing"] },
          { primaryContactId: primaryId, secondaryContactIds: [secondaryId] },
        ],
      })
    );
    expect(res.status).toBe(200);

    const result = await res.json();
    expect(result.failed).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.groups[0]).toMatchObject({ ok: false, errorCode: "not_found" });
    expect(result.groups[1].ok).toBe(true);
  });
});
