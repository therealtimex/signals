/**
 * End-to-end proof that the assist-only mandate is the *server's* decision, run against the real
 * workflow-run, launch, variant, and content tables rather than a mock.
 *
 * The fixture launch records `approvalPolicy: "auto_low_risk"` on purpose: without the mandate, a
 * low-risk passing audit auto-approves. Every assertion here is the difference the run's recorded
 * composition makes — not the difference an optional payload field makes.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getContentItem } from "@/lib/db/queries/content";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { contentItems, launches, variants } from "@/lib/db/schema";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import { buildWritingIntentDraft, toWritingIntentRecord } from "@/lib/writing/writing-intent";
import { resetCoreTables } from "@/test/db";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import {
  createPersonalityWritingFixture,
  personalityLaunchPayload,
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

type ComposedDispatch = ReturnType<typeof composedRun>;
type Fixture = Awaited<ReturnType<typeof createPersonalityWritingFixture>>;

/** Set per test from the fixture, so intents and variants name the same acting target. */
let actingTargetId = "";

/**
 * A launch scoped to a composed dispatch.
 *
 * The scope is stamped server-side from the run the launch names; nothing here sets it, and
 * `upsert_launch` strips a caller-supplied one.
 */
async function composedLaunch(
  dispatch: ComposedDispatch,
  surfaces: readonly ("x/reply" | "x/direct_message")[] = ["x/reply"],
): Promise<string> {
  const created = await invokeAgentTool(
    "upsert_launch",
    personalityLaunchPayload({
      name: `Nurture proposals ${dispatch.run.id}`,
      targetId: actingTargetId,
      workflowRunId: dispatch.run.id,
      surfaces: surfaces.map((surface) => ({ platform: "x", surface, targetId: actingTargetId })),
    }),
  ) as { id: string };
  return created.id;
}

/**
 * A real composed dispatch: a nurture template carrying the opt-in, and a run row whose stored
 * config carries it too. This is the state the server derives the mandate from — an agent cannot
 * conjure it by adding a field to its payload.
 */
function composedRun() {
  const template = createTemplate({
    name: "Contact Relationship Nurture",
    templateType: "nurture",
    status: "active",
    config: JSON.stringify(buildContactNurtureTemplateConfig()),
    isSystem: 1,
  });
  const run = createWorkflowRun({
    templateId: template.id,
    workflowType: "agent",
    config: JSON.stringify(buildContactNurtureTemplateConfig()),
  });
  return { template, run };
}

/** A dispatch with no composition: the same payload has no authority behind it. */
function plainRun() {
  const template = createTemplate({
    name: "Ad-hoc writing",
    templateType: "content",
    status: "active",
    config: JSON.stringify({}),
  });
  return createWorkflowRun({
    templateId: template.id,
    workflowType: "agent",
    config: JSON.stringify({}),
  });
}

/** An active X target that was never bound to the Personality. */
function unrepresentedTarget() {
  return registerPlatformTarget({
    connectionId: ensureBrowserConnection({ sessionName: "writing-intent-foreign" }).id,
    platform: "x",
    kind: "account",
    name: "Someone else",
    handle: "@someone-else",
    capabilities: ["publish"],
    source: "test",
  });
}

function intentFor(
  dispatch: ComposedDispatch,
  overrides: {
    contactId?: string;
    relationshipGoal?: "follow_back" | "partnership";
    workflowRunId?: string;
    templateId?: string;
    surface?: "x/reply" | "x/direct_message";
    targetId?: string | null;
  } = {},
): Record<string, unknown> {
  const contactId = overrides.contactId ?? "contact_recipient";
  return toWritingIntentRecord({
    ...buildWritingIntentDraft({
      intentId: "wint_nurture1",
      consumer: "contact_relationship_nurture",
      lineage: {
        workflowRunId: overrides.workflowRunId ?? dispatch.run.id,
        templateId: overrides.templateId ?? dispatch.template.id,
        templateName: "Contact Relationship Nurture",
      },
      recipient: { kind: "contact", contactId, platform: "x" },
      goal: {
        relationshipGoal: overrides.relationshipGoal ?? "follow_back",
        writingGoal: "follows",
      },
      // The intent's acting target must equal the variant's; a mismatch is rejected.
      target: {
        platform: "x",
        targetId: "targetId" in overrides ? overrides.targetId! : actingTargetId,
      },
      surface: overrides.surface ?? "x/reply",
      sourceRefs: [{ kind: "contact_record", contactId }],
    }),
    bindingId: "unused",
  }) as unknown as Record<string, unknown>;
}

function propose(
  fixture: Fixture,
  options: {
    workflowRunId: string;
    launchId?: string;
    intent?: Record<string, unknown>;
    id?: string;
    targetId?: string | null;
    surface?: "x/reply" | "x/post";
    body?: string;
  },
) {
  const targetId = options.targetId === undefined ? fixture.target.id : options.targetId;
  return upsertVariantUseCase(
    {
      ...personalityVariantPayload({
        launchId: options.launchId ?? fixture.launchId,
        bindingId: fixture.binding.id,
        ...(targetId === null ? {} : { targetId }),
        surface: options.surface ?? "x/reply",
        body: options.body ?? "Answering the actual question with the evidence we already have.",
        voiceProfile: fixture.voiceProfile,
        workflowRunId: options.workflowRunId,
        ...(options.intent ? { intent: options.intent } : {}),
      }),
      ...(options.id ? { id: options.id } : {}),
    },
    fixture.dependencies,
  );
}

async function approve(fixture: Fixture, variantId: string) {
  const materialized = await withPersonalityWritingGuard(
    (guard, tx) => materializeVariantWithRunner({
      variantId,
      approval: { by: "user", evidence: { kind: "ui", route: "/dashboard/contacts" } },
    }, guard, tx),
    fixture.dependencies,
  );
  if ("gateError" in materialized && materialized.gateError) {
    throw new Error(materialized.gateError.reason);
  }
  return materialized;
}

/** Build the fixture and record its represented target so intents can name the same one. */
async function newFixture(): Promise<Fixture> {
  const fixture = await createPersonalityWritingFixture(storageDir, { voice: true });
  actingTargetId = fixture.target.id;
  return fixture;
}

function launchCompositionOf(launchId: string): { surfaces: string[] } & Record<string, unknown> | null {
  const launch = db.select().from(launches).where(eq(launches.id, launchId)).get()!;
  return JSON.parse(launch.metadata ?? "{}").writing?.composition ?? null;
}

function writingOf(variantId: string): {
  approval: Record<string, string | undefined>;
  audit: { id: string; inputHash: string };
  intent?: Record<string, unknown>;
} {
  const row = db.select().from(variants).where(eq(variants.id, variantId)).get()!;
  return JSON.parse(row.metadata ?? "{}").writing;
}

describe("assist-only writing intent authority", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-writing-intent-"));
    env.STORAGE_DIR = storageDir;
    actingTargetId = "";
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("still auto-approves an ordinary platform-native artifact", () => {
    // The policy lane must keep working; only composed artifacts are pinned to explicit.
    return newFixture().then(async (fixture) => {
      const variant = await propose(fixture, {
        workflowRunId: plainRun().id,
        surface: "x/post",
        body: "An ordinary platform-native post that the policy may approve.",
      });
      expect(writingOf(variant.id).approval).toMatchObject({
        state: "approved",
        by: "policy",
        policy: "auto_low_risk",
      });
    });
  });

  it("stamps the composition scope onto a launch from the run it names, and never from the caller", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    const scope = launchCompositionOf(launchId)!;
    expect(scope).toMatchObject({
      workflowRunId: dispatch.run.id,
      templateId: dispatch.template.id,
      consumer: "contact_relationship_nurture",
      mandate: "assist_only",
    });
    // The scope carries the consumer's enabled set, not whatever this launch declared.
    expect(scope.surfaces).toContain("x/reply");
    expect(scope.surfaces).not.toContain("x/post");
    expect(launchCompositionOf(fixture.launchId)).toBeNull();

    // A caller cannot mint a scope on an ordinary launch...
    await invokeAgentTool("upsert_launch", {
      id: fixture.launchId,
      name: "Personality publish proof",
      metadata: {
        writing: {
          schemaVersion: 1,
          composition: {
            schemaVersion: 1,
            workflowRunId: dispatch.run.id,
            templateId: dispatch.template.id,
            consumer: "contact_relationship_nurture",
            mandate: "assist_only",
            surfaces: ["x/post"],
            stampedAt: 10,
          },
        },
      },
    });
    expect(launchCompositionOf(fixture.launchId)).toBeNull();

    // ...nor widen or drop one that exists.
    await invokeAgentTool("upsert_launch", {
      id: launchId,
      name: "Nurture proposals",
      metadata: {
        writing: {
          schemaVersion: 1,
          composition: { schemaVersion: 1, workflowRunId: plainRun().id, templateId: null, consumer: "contact_relationship_nurture", mandate: "assist_only", surfaces: ["x/post"], stampedAt: 10 },
        },
      },
    });
    expect(launchCompositionOf(launchId)).toMatchObject({ workflowRunId: dispatch.run.id });
    expect(launchCompositionOf(launchId)!.surfaces).not.toContain("x/post");
  });

  it("rejects an ordinary run plus x/post and no intent inside a composed scope", async () => {
    // The exact bypass Review specified: both caller-owned fields moved at once. The launch scope
    // is server-owned, so neither move helps.
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const before = db.select().from(variants).all().length;

    await expect(propose(fixture, {
      launchId,
      workflowRunId: plainRun().id,
      surface: "x/post",
      body: "A publishable post smuggled onto a nurture launch.",
    })).rejects.toMatchObject({ details: { reason: "writing_intent_required" } });

    expect(db.select().from(variants).all()).toHaveLength(before);
  });

  it("rejects a publish-capable surface inside a composed scope even with an intent", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      surface: "x/post",
      body: "A publishable post smuggled onto a nurture launch.",
      intent: intentFor(dispatch),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_surface_mismatch" } });
  });

  it("rejects an assist-only surface on a launch with no composed scope", async () => {
    const fixture = await newFixture();

    await expect(propose(fixture, { workflowRunId: plainRun().id })).rejects.toMatchObject({
      details: { reason: "composed_scope_required" },
    });
  });

  it("refuses a composed scope that omits the intent", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    await expect(propose(fixture, { launchId, workflowRunId: dispatch.run.id })).rejects.toMatchObject({
      details: { reason: "writing_intent_required" },
    });
  });

  it("refuses an intent on a launch that has no composed scope", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();

    await expect(propose(fixture, {
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_not_permitted" } });
  });

  it("refuses a generation pointer that disagrees with the launch scope", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    await expect(propose(fixture, {
      launchId,
      workflowRunId: plainRun().id,
      intent: intentFor(dispatch),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_lineage_mismatch" } });
  });

  it("refuses an intent whose lineage names another run or template", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, { workflowRunId: plainRun().id }),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_lineage_mismatch" } });

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, { templateId: "tpl_other" }),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_lineage_mismatch" } });
  });

  it("refuses an intent whose acting target differs from the variant's", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, { targetId: null }),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_target_mismatch" } });

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, { targetId: unrepresentedTarget().id }),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_target_mismatch" } });
  });

  it("requires a compatible represented target even on a draft-only surface", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const foreign = unrepresentedTarget();

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, { targetId: foreign.id }),
      targetId: foreign.id,
    })).rejects.toMatchObject({ details: { reason: "target_identity_mismatch" } });
  });

  it("pins explicit approval on a composed proposal under an auto_low_risk launch", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    });
    const writing = writingOf(proposal.id);

    expect(writing.approval).toMatchObject({ state: "pending", policy: "explicit" });
    expect(writing.approval.by).toBeUndefined();
    expect(writing.intent).toMatchObject({ mandate: "assist_only", intentId: "wint_nurture1" });
  });

  it("refuses materialization without real user approval evidence", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    });

    await expect(withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({ variantId: proposal.id }, guard, tx),
      fixture.dependencies,
    )).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });

    expect(db.select().from(contentItems).all().some((item) => item.contentType === "reply")).toBe(false);
  });

  it("materializes an explicitly approved proposal as a reply that carries its intent", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    });
    const materialized = await approve(fixture, proposal.id);

    const item = getContentItem(materialized.contentItemId)!;
    expect(item.contentType).toBe("reply");
    expect(item.status).toBe("approved");
    expect(materialized.nextAction).toBe("export");
    const stored = JSON.parse(item.platformData ?? "{}").writing;
    expect(stored.intent).toMatchObject({
      mandate: "assist_only",
      consumer: "contact_relationship_nurture",
      lineage: { workflowRunId: dispatch.run.id, templateId: dispatch.template.id },
      recipient: { contactId: "contact_recipient" },
      goal: { id: "follow_back" },
    });
    expect(stored.intent.bindingId).toBeUndefined();
    expect(stored.personality.bindingId).toBe(fixture.binding.id);
  });

  it("revokes approval when an approved proposal is rebound to another recipient or goal", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    });
    await approve(fixture, proposal.id);
    const approved = writingOf(proposal.id);
    expect(approved.approval).toMatchObject({ state: "approved", by: "user" });

    // Same body, same target, same audit text — only the recipient and goal move.
    const rebound = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch, {
        contactId: "contact_someone_else",
        relationshipGoal: "partnership",
      }),
      id: proposal.id,
    });
    const after = writingOf(rebound.id);

    expect(after.audit.inputHash).not.toBe(approved.audit.inputHash);
    expect(after.approval).toMatchObject({ state: "revoked", revokedReason: "audit_stale" });
    await expect(withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({ variantId: rebound.id }, guard, tx),
      fixture.dependencies,
    )).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("never lets an approved proposal reach the publish lane", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    });
    const materialized = await approve(fixture, proposal.id);

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
