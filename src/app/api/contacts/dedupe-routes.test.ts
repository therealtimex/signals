import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as scanRoute } from "@/app/api/contacts/dedupe/scan/route";
import { POST as mergeRoute } from "@/app/api/contacts/dedupe/merge/route";
import { db } from "@/lib/db/client";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
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

  it("merges a reviewed group and archives the secondary", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();

    const res = await mergeRoute(
      post("http://localhost/api/contacts/dedupe/merge", {
        primaryContactId: primaryId,
        secondaryContactIds: [secondaryId],
      })
    );
    expect(res.status).toBe(200);

    const result = await res.json();
    expect(result.dryRun).toBe(false);
    expect(result.merged).toEqual([
      expect.objectContaining({ contactId: secondaryId, status: "merged" }),
    ]);
    expect(getContactById(primaryId)).toBeDefined();
  });

  it("reports a second merge of the same group as already merged", async () => {
    const { primaryId, secondaryId } = seedSharedEmailPair();
    const body = { primaryContactId: primaryId, secondaryContactIds: [secondaryId] };

    await mergeRoute(post("http://localhost/api/contacts/dedupe/merge", body));
    const res = await mergeRoute(post("http://localhost/api/contacts/dedupe/merge", body));

    expect(res.status).toBe(200);
    expect((await res.json()).merged[0].status).toBe("already_merged");
  });

  it("404s an unknown primary", async () => {
    const res = await mergeRoute(
      post("http://localhost/api/contacts/dedupe/merge", {
        primaryContactId: "missing",
        secondaryContactIds: ["also-missing"],
      })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).errorCode).toBe("not_found");
  });
});
