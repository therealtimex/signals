/**
 * End-to-end proof that a composed `assist_only` proposal cannot approve itself or reach a send
 * adapter, run against the real launch/variant/content tables rather than a mock.
 *
 * The fixture launch records `approvalPolicy: "auto_low_risk"` on purpose: without the mandate,
 * a low-risk passing audit auto-approves. Every assertion here is the difference the intent makes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getContentItem } from "@/lib/db/queries/content";
import { contentItems, variants } from "@/lib/db/schema";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import { buildWritingIntentDraft, toWritingIntentRecord } from "@/lib/writing/writing-intent";
import { resetCoreTables } from "@/test/db";
import {
  createPersonalityWritingFixture,
  personalityVariantPayload,
} from "@/test/personality-writing-fixture";

let storageDir = "";

/** Embedded-host env; without it `sendContentToAgent` short-circuits before the capability gate. */
const env: NodeJS.ProcessEnv = {
  ...process.env,
  RTX_APP_ID: "app-test",
  RTX_API_BASE_URL: "http://127.0.0.1:3001",
  SIGNALS_RTX_WORKSPACE_SLUG: "signals",
};

const intentRecord = toWritingIntentRecord({
  ...buildWritingIntentDraft({
    intentId: "wint_nurture1",
    consumer: "contact_relationship_nurture",
    lineage: {
      workflowRunId: "run-personality-proof",
      templateId: "tpl_nurture",
      templateName: "Contact Relationship Nurture",
    },
    recipient: { kind: "contact", contactId: "contact_recipient", platform: "x" },
    goal: { relationshipGoal: "follow_back", writingGoal: "follows" },
    target: { platform: "x", targetId: null },
    surface: "x/reply",
    sourceRefs: [{ kind: "contact_record", contactId: "contact_recipient" }],
  }),
  bindingId: "unused",
}) as unknown as Record<string, unknown>;

async function proposeNurtureVariant(fixture: Awaited<ReturnType<typeof createPersonalityWritingFixture>>, options: { intent: boolean }) {
  return upsertVariantUseCase(
    personalityVariantPayload({
      launchId: fixture.launchId,
      bindingId: fixture.binding.id,
      targetId: fixture.target.id,
      surface: "x/reply",
      body: "Answering the actual question with the evidence we already have.",
      voiceProfile: fixture.voiceProfile,
      ...(options.intent ? { intent: intentRecord } : {}),
    }),
    fixture.dependencies,
  );
}

function writingOf(variantId: string): Record<string, never> & { approval: Record<string, string>; intent?: unknown } {
  const row = db.select().from(variants).where(eq(variants.id, variantId)).get()!;
  return JSON.parse(row.metadata ?? "{}").writing;
}

describe("assist-only writing intent pipeline", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-writing-intent-"));
    env.STORAGE_DIR = storageDir;
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("auto-approves the same proposal only when no assist-only intent is attached", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const unbounded = await proposeNurtureVariant(fixture, { intent: false });
    expect(writingOf(unbounded.id).approval).toMatchObject({
      state: "approved",
      by: "policy",
      policy: "auto_low_risk",
    });
  });

  it("pins explicit approval on a composed proposal under an auto_low_risk launch", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const proposal = await proposeNurtureVariant(fixture, { intent: true });
    const writing = writingOf(proposal.id);

    expect(writing.approval).toMatchObject({ state: "pending", policy: "explicit" });
    expect(writing.approval.by).toBeUndefined();
    expect(writing.intent).toMatchObject({ mandate: "assist_only", intentId: "wint_nurture1" });
  });

  it("refuses materialization without real user approval evidence", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const proposal = await proposeNurtureVariant(fixture, { intent: true });

    await expect(withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({ variantId: proposal.id }, guard, tx),
      fixture.dependencies,
    )).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    expect(db.select().from(contentItems).all().some((item) => item.contentType === "reply")).toBe(false);
  });

  it("materializes an explicitly approved proposal as a reply that carries its intent", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const proposal = await proposeNurtureVariant(fixture, { intent: true });

    const materialized = await withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({
        variantId: proposal.id,
        approval: {
          by: "user",
          evidence: { kind: "ui", route: "/dashboard/contacts" },
        },
      }, guard, tx),
      fixture.dependencies,
    );
    if ("gateError" in materialized && materialized.gateError) {
      throw new Error(materialized.gateError.reason);
    }

    const item = getContentItem(materialized.contentItemId)!;
    expect(item.contentType).toBe("reply");
    expect(item.status).toBe("approved");
    expect(materialized.nextAction).toBe("export");
    const stored = JSON.parse(item.platformData ?? "{}").writing;
    expect(stored.intent).toMatchObject({
      mandate: "assist_only",
      consumer: "contact_relationship_nurture",
      lineage: { workflowRunId: "run-personality-proof", templateId: "tpl_nurture" },
      recipient: { contactId: "contact_recipient" },
      goal: { id: "follow_back" },
    });
    expect(stored.intent.bindingId).toBeUndefined();
    expect(stored.personality.bindingId).toBe(fixture.binding.id);
  });

  it("never lets an approved proposal reach the publish lane", async () => {
    const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
    const proposal = await proposeNurtureVariant(fixture, { intent: true });
    const materialized = await withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({
        variantId: proposal.id,
        approval: { by: "user", evidence: { kind: "ui", route: "/dashboard/contacts" } },
      }, guard, tx),
      fixture.dependencies,
    );
    if ("gateError" in materialized && materialized.gateError) {
      throw new Error(materialized.gateError.reason);
    }

    await expect(sendContentToAgent({
      contentItemId: materialized.contentItemId,
      platforms: ["x"],
      targets: [{ targetId: fixture.target.id }],
      text: "ignored",
    }, env)).resolves.toMatchObject({
      success: false,
      errorCode: "capability_unsupported",
    });
    expect(getContentItem(materialized.contentItemId)?.status).toBe("approved");
  });
});
