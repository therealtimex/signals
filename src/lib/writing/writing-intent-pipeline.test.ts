/**
 * End-to-end proof that the assist-only mandate is the *server's* decision, run against the real
 * workflow-run, launch, variant, and content tables rather than a mock.
 *
 * The fixture launch records `approvalPolicy: "auto_low_risk"` on purpose: without the mandate, a
 * low-risk passing audit auto-approves. Every assertion here is the difference the run's recorded
 * composition makes — not the difference an optional payload field makes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { contentItems, launches, variants, workflowRuns } from "@/lib/db/schema";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { sendContentToAgent } from "@/lib/publish/send-to-agent";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import { buildWritingIntentDraft, toWritingIntentRecord } from "@/lib/writing/writing-intent";
import {
  WRITING_SCOPE_TOKEN_CONFIG_KEY,
  mintWritingScopeToken,
} from "@/lib/writing/writing-scope-token";
import { resetCoreTables } from "@/test/db";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import {
  createPersonalityWritingFixture,
  personalityLaunchPayload,
  personalityVariantPayload,
} from "@/test/personality-writing-fixture";
import { createContact } from "@/lib/db/queries/contacts";
import { logInteraction } from "@/lib/db/queries/interactions";
import {
  ACCOUNT_OBJECTIVE_CONFIG_KEY,
  normalizeAccountObjective,
  type AccountObjective,
} from "@/lib/writing/account-objective";
import { listWorkflowRunProposals } from "@/lib/writing/workflow-run-proposals";
import { observeObjectiveSources, observeObjectiveSourcesForRun } from "@/lib/writing/objective-sources";
import { COMMERCIAL_BRIEF, PRODUCTS_FIXTURE, bigProductsFixture } from "@/test/account-objective-fixture";

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
  const created = await invokeAgentTool("upsert_launch", {
    ...personalityLaunchPayload({
      name: `Nurture proposals ${dispatch.run.id}`,
      targetId: actingTargetId,
      workflowRunId: dispatch.run.id,
      surfaces: surfaces.map((surface) => ({ platform: "x", surface, targetId: actingTargetId })),
    }),
    writingScopeToken: dispatch.token,
  }) as { id: string };
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
  // Mirrors what `run-template-via-rtx.ts` does at dispatch: mint, persist the hash, hand the
  // plaintext to this run's brief only.
  const scope = mintWritingScopeToken(run.id);
  db.update(workflowRuns)
    .set({
      config: JSON.stringify({
        ...buildContactNurtureTemplateConfig(),
        [WRITING_SCOPE_TOKEN_CONFIG_KEY]: scope.tokenHash,
      }),
    })
    .where(eq(workflowRuns.id, run.id))
    .run();
  return { template, run, token: scope.token };
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

  it("mints a scope only from the dispatch-issued token, never from a caller-named run", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();

    // Naming the composed run in caller-owned `writing.runs`, through the public tool, mints nothing.
    const named = await invokeAgentTool("upsert_launch", personalityLaunchPayload({
      name: "Launch naming a composed run",
      targetId: actingTargetId,
      workflowRunId: dispatch.run.id,
      surfaces: [{ platform: "x", surface: "x/reply", targetId: actingTargetId }],
    })) as { id: string };
    expect(launchCompositionOf(named.id)).toBeNull();

    // A token that does not verify fails the call outright — presenting one is an explicit
    // composed-lane attempt, so silently downgrading it to an unscoped launch would hide a real
    // dispatch's broken capability until its first proposal was rejected.
    const other = composedRun();
    const before = db.select().from(launches).all().length;
    for (const badToken of [
      `${dispatch.run.id}.${other.token.split(".")[1]}`, // this run's id, another dispatch's secret
      `${dispatch.run.id}.not-the-secret`,
      "malformed-token",
      `run_does_not_exist.${dispatch.token.split(".")[1]}`,
    ]) {
      await expect(invokeAgentTool("upsert_launch", {
        ...personalityLaunchPayload({
          name: "Launch with a tampered token",
          targetId: actingTargetId,
          workflowRunId: dispatch.run.id,
          surfaces: [{ platform: "x", surface: "x/reply", targetId: actingTargetId }],
        }),
        writingScopeToken: badToken,
      })).rejects.toMatchObject({ details: { reason: "writing_scope_token_invalid" } });
    }
    expect(db.select().from(launches).all()).toHaveLength(before);

    // Another dispatch's *valid* token is a valid capability — for that dispatch. It mints a scope
    // bound to that run, so it cannot be used to attribute work to this one; the lineage check
    // downstream rejects that. (An agent able to read another run's brief is the documented
    // capability bound, not a hole in the binding itself.)
    const borrowed = await invokeAgentTool("upsert_launch", {
      ...personalityLaunchPayload({
        name: "Launch built with another dispatch's token",
        targetId: actingTargetId,
        surfaces: [{ platform: "x", surface: "x/reply", targetId: actingTargetId }],
      }),
      writingScopeToken: other.token,
    }) as { id: string };
    expect(launchCompositionOf(borrowed.id)).toMatchObject({ workflowRunId: other.run.id });
    await expect(propose(fixture, {
      launchId: borrowed.id,
      workflowRunId: dispatch.run.id,
      intent: intentFor(dispatch),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_lineage_mismatch" } });

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

    // A caller cannot mint a scope on an ordinary launch by supplying `composition` directly...
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

  it("documents the boundary: ordinary writing beside an active dispatch is never a proposal", async () => {
    // The one case the server cannot prevent — there is no per-invocation identity, so an ordinary
    // launch + ordinary run + publish-capable surface is indistinguishable from any other writing
    // workflow. What is asserted here is the guarantee that *does* hold: the artifact carries no
    // composition scope, no intent, and no nurture lineage, so it can never be counted as a
    // proposal of the active dispatch. See "What this does not claim" in
    // docs/composable-writing-intent.md.
    const fixture = await newFixture();
    const dispatch = composedRun();
    await composedLaunch(dispatch);

    const escaped = await propose(fixture, {
      workflowRunId: plainRun().id,
      surface: "x/post",
      body: "Ordinary writing that is not attributed to the nurture dispatch.",
    });
    const writing = writingOf(escaped.id);

    expect(writing.approval).toMatchObject({ state: "approved", by: "policy" });
    expect(writing.intent).toBeUndefined();
    expect(launchCompositionOf(fixture.launchId)).toBeNull();
    // Nothing links it to the dispatch: no proposal lineage exists to be forged or miscounted.
    expect(JSON.stringify(writing)).not.toContain(dispatch.run.id);
    expect(JSON.stringify(writing)).not.toContain(dispatch.template.id);
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

/* ------------------------------------------------------------------------------------------------
 * #549 — account objective through the writing handoff (spec §11 synthetic regression).
 *
 * The dogfood failure: an operator dispatched a run to qualify an engineering-workflow offering,
 * and the typed handoff carried only `warm_conversation / replies`, so a grounded, audited DM asked
 * the founder an unrelated customer-product question. Here the objective is a server-stamped
 * authority, so that draft cannot be persisted without saying how it relates to the objective.
 * ---------------------------------------------------------------------------------------------- */

const ASK_TESTS_UNKNOWN = {
  statement: "Ask how they get new engineers productive in their first week.",
  relation: "tests" as const,
  testsUncertainty: 1,
  customerPain: { status: "none_assumed" as const },
};

async function stampedObjective(fixture: Fixture, raw: unknown): Promise<AccountObjective> {
  // PRODUCTS.md is not a managed Personality file, so writing it leaves the binding current; the
  // fixture's own BRAND.md resolves the brief's `@BRAND.md` mention.
  writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE);
  const result = await normalizeAccountObjective({
    raw,
    source: raw === undefined ? "default" : "run_config",
    resolveWorkspace: async () => fixture.workspace,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.objective;
}

/** A composed dispatch whose run row carries the normalized objective, as dispatch writes it. */
function objectiveRun(objective: AccountObjective) {
  const dispatch = composedRun();
  const config = JSON.parse(db.select().from(workflowRuns).where(eq(workflowRuns.id, dispatch.run.id)).get()!.config ?? "{}");
  db.update(workflowRuns)
    .set({ config: JSON.stringify({ ...config, [ACCOUNT_OBJECTIVE_CONFIG_KEY]: objective }) })
    .where(eq(workflowRuns.id, dispatch.run.id))
    .run();
  return dispatch;
}

/** The synthetic founder: already connected, with one recent approved outbound touch. */
function syntheticFounder(): string {
  const founder = createContact({
    name: "Synthetic Founder",
    relationshipGoal: "warm_conversation",
    relationshipGoalStatus: "in_progress",
  });
  logInteraction({
    contactId: founder.id,
    interactionType: "dm",
    direction: "outbound",
    summary: "Approved congratulation on the funding announcement.",
    isMeaningful: true,
    occurredAt: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60,
  });
  return founder.id;
}

function objectiveIntent(
  dispatch: ComposedDispatch,
  input: {
    contactId: string;
    objective?: { objectiveId: string; hash: string } | null;
    ask?: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  const intent = toWritingIntentRecord({
    ...buildWritingIntentDraft({
      intentId: "wint_objective1",
      consumer: "contact_relationship_nurture",
      lineage: { workflowRunId: dispatch.run.id, templateId: dispatch.template.id },
      recipient: { kind: "contact", contactId: input.contactId, platform: "x" },
      goal: { relationshipGoal: "warm_conversation", writingGoal: "replies" },
      target: { platform: "x", targetId: actingTargetId },
      surface: "x/reply",
      sourceRefs: [{ kind: "contact_record", contactId: input.contactId }],
    }),
    bindingId: "unused",
  }) as unknown as Record<string, unknown>;
  return {
    ...intent,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.ask !== undefined ? { ask: input.ask } : {}),
  };
}

function refOf(objective: AccountObjective) {
  return { objectiveId: objective.objectiveId, hash: objective.hash };
}

/** Re-send a payload as a derived alternative (`mode: adapt`, `derivedFromVariantId`). */
function asDerived(payload: ReturnType<typeof personalityVariantPayload>, fromVariantId: string) {
  const generation = { ...payload.generationMetadata, mode: "adapt", requestHash: `derived-${fromVariantId}` };
  const writing = payload.metadata.writing as Record<string, unknown>;
  return {
    ...payload,
    generationMetadata: generation,
    metadata: {
      writing: {
        ...writing,
        lineage: { ...(writing.lineage as Record<string, unknown>), derivedFromVariantId: fromVariantId },
      },
    },
  };
}

describe("account objective through the writing handoff (#549)", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-account-objective-"));
    env.STORAGE_DIR = storageDir;
    actingTargetId = "";
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("does not let an engineering-workflow objective silently become an unrelated question", async () => {
    const fixture = await newFixture();
    const objective = await stampedObjective(fixture, {
      kind: "commercial",
      brief: { kind: "inline", text: COMMERCIAL_BRIEF },
    });
    const dispatch = objectiveRun(objective);
    const launchId = await composedLaunch(dispatch);
    const founder = syntheticFounder();
    expect(launchCompositionOf(launchId)).toMatchObject({ objective: { objectiveId: objective.objectiveId, hash: objective.hash } });

    const attempt = (intent: Record<string, unknown>, extra: { id?: string; body?: string } = {}) => propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent,
      ...extra,
    });

    // 1. The objective reference and the ask are required, and must match the stamped record.
    await expect(attempt(objectiveIntent(dispatch, { contactId: founder, ask: ASK_TESTS_UNKNOWN })))
      .rejects.toMatchObject({ details: { reason: "writing_intent_objective_required" } });
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: { objectiveId: objective.objectiveId, hash: "0".repeat(64) },
      ask: ASK_TESTS_UNKNOWN,
    }))).rejects.toMatchObject({ details: { reason: "writing_intent_objective_mismatch" } });
    await expect(attempt(objectiveIntent(dispatch, { contactId: founder, objective: refOf(objective) })))
      .rejects.toMatchObject({ details: { reason: "writing_intent_ask_required" } });

    // 2. The dogfood DM — a customer-product question with no stated relation — cannot pass as
    // relationship-only on a commercial objective; it has to say it defers, and why.
    const unrelated = "Congrats on the round! Which customer segment is growing fastest for you?";
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { statement: "Ask which customer segment is growing fastest.", relation: "relationship_only", customerPain: { status: "none_assumed" } },
    }), { body: unrelated })).rejects.toMatchObject({ details: { reason: "writing_intent_ask_relation_invalid" } });
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { ...ASK_TESTS_UNKNOWN, testsUncertainty: 2 },
    }))).rejects.toMatchObject({ details: { reason: "writing_intent_ask_relation_invalid" } });
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { statement: "Congratulate without an ask.", relation: "defers", customerPain: { status: "none_assumed" } },
    }))).rejects.toMatchObject({ details: { reason: "writing_intent_ask_relation_invalid" } });
    const deferred = await attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: {
        statement: "Ask which customer segment is growing fastest.",
        relation: "defers",
        deferReason: "A recent touch already congratulated them; this keeps the thread warm before the evaluation ask.",
        customerPain: { status: "none_assumed" },
      },
    }), { body: unrelated });
    expect(writingOf(deferred.id).intent).toMatchObject({ ask: { relation: "defers" } });

    // The ask may lean on evidence only through the spine.
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { ...ASK_TESTS_UNKNOWN, customerPain: { status: "evidenced", claimIds: ["clm_notinspine"] } },
    }), { body: "A different body for the evidence check." })).rejects.toMatchObject({ details: { reason: "ask_claim_unknown" } });
    await expect(attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { ...ASK_TESTS_UNKNOWN, evidenceSourceIds: ["src_notinspine"] },
    }), { body: "Another body for the source check." })).rejects.toMatchObject({ details: { reason: "ask_source_unknown" } });

    // 3. A proposal that tests the named unknown reaches the run page with the objective beside it,
    // and the platform metric is still `replies`, separate from the business outcome.
    const proposal = await attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: { ...ASK_TESTS_UNKNOWN, customerPain: { status: "evidenced", claimIds: ["clm_personality1"] } },
    }), { body: "How do new engineers on your team get productive in their first week?" });
    const projection = listWorkflowRunProposals(dispatch.run.id);
    expect(projection.objective).toMatchObject({
      objectiveId: objective.objectiveId,
      kind: "commercial",
      offering: { slug: "engineering-workflow" },
      parsed: {
        fit: "Technical founder hiring engineers.",
        unknowns: ["Whether they use a coding agent today"],
        nextStep: "Ask which workflow they use for new hires.",
      },
    });
    expect(projection.objectiveSource).toMatchObject({ status: "current", changedPaths: [] });
    const card = projection.proposals.find((entry) => entry.variantId === proposal.id);
    expect(card).toMatchObject({
      valid: true,
      goal: { relationshipGoal: "warm_conversation", writingGoal: "replies" },
      ask: {
        relation: "tests",
        testsUncertainty: 1,
        customerPain: {
          status: "evidenced",
          claims: [{ claimId: "clm_personality1", text: "Personality-bound publish proof.", sensitivity: "public" }],
        },
      },
    });

    // The agent reads the same stamped objective from Signals, and the ask per variant (thread card).
    const context = await invokeAgentTool("get_writing_context", { launchId }) as {
      launch: { writing: { composition: Record<string, unknown>; objectiveSource: Record<string, unknown> | null } };
      variants: Array<{ id: string; intent: Record<string, unknown> | null }>;
    };
    expect(context.launch.writing.composition).toEqual({
      consumer: "contact_relationship_nurture",
      mandate: "assist_only",
      workflowRunId: dispatch.run.id,
      surfaces: expect.arrayContaining(["x/reply"]),
      objective,
    });
    // The test host has no RealTimeX workspace identity, so the sources cannot be re-read.
    expect(context.launch.writing.objectiveSource).toMatchObject({ status: "unavailable", changedPaths: [] });
    expect(context.variants.find((variant) => variant.id === proposal.id)?.intent).toEqual({
      goal: { kind: "relationship_goal", id: "warm_conversation", writingGoal: "replies" },
      objective: refOf(objective),
      ask: expect.objectContaining({ relation: "tests", testsUncertainty: 1 }),
    });

    // 4. Neither an in-place revision nor a derived alternative can shed the objective reference.
    await expect(attempt(objectiveIntent(dispatch, { contactId: founder, ask: ASK_TESTS_UNKNOWN }), {
      id: proposal.id,
      body: "How do new engineers on your team get productive in their first week?",
    })).rejects.toMatchObject({ details: { reason: "writing_intent_objective_required" } });
    const derivedPayload = asDerived(personalityVariantPayload({
      launchId,
      bindingId: fixture.binding.id,
      targetId: fixture.target.id,
      surface: "x/reply",
      body: "A shorter alternative that still asks about onboarding.",
      voiceProfile: fixture.voiceProfile,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, { contactId: founder, ask: ASK_TESTS_UNKNOWN }),
    }), proposal.id);
    await expect(upsertVariantUseCase(derivedPayload, fixture.dependencies))
      .rejects.toMatchObject({ details: { reason: "writing_intent_objective_required" } });
    const derivedOk = asDerived(personalityVariantPayload({
      launchId,
      bindingId: fixture.binding.id,
      targetId: fixture.target.id,
      surface: "x/reply",
      body: "A shorter alternative that still asks about onboarding.",
      voiceProfile: fixture.voiceProfile,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, { contactId: founder, objective: refOf(objective), ask: ASK_TESTS_UNKNOWN }),
    }), proposal.id);
    await expect(upsertVariantUseCase(derivedOk, fixture.dependencies)).resolves.toBeDefined();

    // 5. Materialization carries the objective reference and the ask into the content snapshot; a
    // later revision that changes the ask revokes the approval, so the operator re-approves it.
    const materialized = await approve(fixture, proposal.id);
    const stored = JSON.parse(getContentItem(materialized.contentItemId)!.platformData ?? "{}").writing;
    expect(stored.intent).toMatchObject({
      objective: refOf(objective),
      ask: { relation: "tests", testsUncertainty: 1 },
      goal: { writingGoal: "replies" },
    });
    const approved = writingOf(proposal.id);
    const revised = await attempt(objectiveIntent(dispatch, {
      contactId: founder,
      objective: refOf(objective),
      ask: {
        statement: "Propose the 20-minute evaluation directly.",
        relation: "advances",
        customerPain: { status: "asked", text: "Is onboarding new engineers slower than you want?" },
      },
    }), { id: proposal.id, body: "How do new engineers on your team get productive in their first week?" });
    const after = writingOf(revised.id);
    expect(after.audit.inputHash).not.toBe(approved.audit.inputHash);
    expect(after.approval).toMatchObject({ state: "revoked", revokedReason: "audit_stale" });
  });

  it("stamps relationship-only by default and refuses a commercial ask under it", async () => {
    const fixture = await newFixture();
    const objective = await stampedObjective(fixture, undefined);
    expect(objective).toMatchObject({ kind: "relationship_only", source: "default", limitations: [] });
    const dispatch = objectiveRun(objective);
    const launchId = await composedLaunch(dispatch);
    const founder = syntheticFounder();

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, {
        contactId: founder,
        objective: refOf(objective),
        ask: { statement: "Propose the evaluation.", relation: "advances", customerPain: { status: "none_assumed" } },
      }),
    })).rejects.toMatchObject({ details: { reason: "writing_intent_ask_relation_invalid" } });
    const kept = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, {
        contactId: founder,
        objective: refOf(objective),
        ask: { statement: "Say congratulations on the launch.", relation: "relationship_only", customerPain: { status: "none_assumed" } },
      }),
    });
    expect(listWorkflowRunProposals(dispatch.run.id)).toMatchObject({
      objective: { kind: "relationship_only", source: "default" },
      proposals: [expect.objectContaining({ variantId: kept.id, ask: expect.objectContaining({ relation: "relationship_only" }) })],
    });
  });

  it("supports a missing or unresolved offering with a truthful limitation", async () => {
    const fixture = await newFixture();
    const missing = await stampedObjective(fixture, {
      kind: "commercial",
      brief: { kind: "inline", text: "## Outcome\nBook an evaluation call.\n## Fit\nFounders.\n## Success\nA reply." },
    });
    expect(missing.limitations).toEqual(["offering_missing"]);
    const unresolved = await stampedObjective(fixture, {
      kind: "commercial",
      brief: { kind: "inline", text: "## Outcome\nEvaluate @PRODUCTS.md#not-in-catalog.\n## Fit\nFounders.\n## Success\nA reply." },
    });
    expect(unresolved).toMatchObject({ offering: null, limitations: ["offering_unresolved"] });

    const dispatch = objectiveRun(missing);
    await composedLaunch(dispatch);
    expect(listWorkflowRunProposals(dispatch.run.id).objective?.limitations).toEqual(["offering_missing"]);
  });

  it("shows the objective saved at dispatch before the agent creates any launch (Review #549 F2)", async () => {
    const fixture = await newFixture();
    const objective = await stampedObjective(fixture, {
      kind: "commercial",
      brief: { kind: "inline", text: COMMERCIAL_BRIEF },
    });
    const dispatch = objectiveRun(objective);

    const projection = listWorkflowRunProposals(dispatch.run.id);
    expect(projection).toMatchObject({
      launches: [],
      proposals: [],
      objective: { objectiveId: objective.objectiveId, kind: "commercial", offering: { slug: "engineering-workflow" } },
      objectiveSource: { status: "current", changedPaths: [], observedAt: null },
    });

    // Without a launch there is nothing to revoke and nowhere to record, but the page still learns
    // that the files moved.
    const resolve = async () => fixture.workspace;
    expect(await observeObjectiveSourcesForRun(dispatch.run.id, resolve)).toMatchObject({
      objectiveSource: { status: "current", changedPaths: [] },
      revokedVariantIds: [],
    });
    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE.replace("Terminals and browsers.", "Terminals only."));
    expect(await observeObjectiveSourcesForRun(dispatch.run.id, resolve)).toMatchObject({
      objectiveSource: { status: "stale", changedPaths: ["PRODUCTS.md#engineering-workflow"] },
      revokedVariantIds: [],
    });
    expect(await observeObjectiveSourcesForRun(dispatch.run.id, async () => { throw new Error("down"); }))
      .toMatchObject({ objectiveSource: { status: "unavailable" } });

    // A composed run from before #549 still projects no objective.
    expect(listWorkflowRunProposals(composedRun().run.id)).toMatchObject({ objective: null, objectiveSource: null });
    expect(await observeObjectiveSourcesForRun(composedRun().run.id, resolve)).toBeNull();
  });

  it("keeps launches stamped before #549 readable and refuses an objective reference on them", async () => {
    const fixture = await newFixture();
    const dispatch = composedRun();
    const launchId = await composedLaunch(dispatch);
    const objective = await stampedObjective(fixture, { kind: "relationship_only" });

    await expect(propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: { ...intentFor(dispatch), objective: refOf(objective) },
    })).rejects.toMatchObject({ details: { reason: "writing_intent_objective_not_permitted" } });
    const legacy = await propose(fixture, { launchId, workflowRunId: dispatch.run.id, intent: intentFor(dispatch) });
    expect(listWorkflowRunProposals(dispatch.run.id)).toMatchObject({
      objective: null,
      objectiveSource: null,
      proposals: [expect.objectContaining({ variantId: legacy.id, ask: null })],
    });
  });
});

describe("objective sources that change after launch (#549, ADR-549-24)", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-objective-sources-"));
    env.STORAGE_DIR = storageDir;
    actingTargetId = "";
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  /** Composed proposals are approved only by materializing; set the stored state directly. */
  function markApproved(variantId: string) {
    const row = db.select().from(variants).where(eq(variants.id, variantId)).get()!;
    const metadata = JSON.parse(row.metadata ?? "{}");
    metadata.writing.approval = {
      ...metadata.writing.approval,
      state: "approved",
      by: "user",
      at: 100,
      evidence: { kind: "ui", route: "/dashboard/workflows" },
    };
    db.update(variants).set({ metadata: JSON.stringify(metadata) }).where(eq(variants.id, variantId)).run();
  }

  async function savedBriefRun(fixture: Fixture) {
    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE);
    mkdirSync(join(fixture.workspace.dir, "objectives"), { recursive: true });
    writeFileSync(join(fixture.workspace.dir, "objectives", "eng-founders.md"), COMMERCIAL_BRIEF);
    const objective = await stampedObjective(fixture, {
      kind: "commercial",
      brief: { kind: "saved", path: "objectives/eng-founders.md" },
    });
    const dispatch = objectiveRun(objective);
    const launchId = await composedLaunch(dispatch);
    const founder = syntheticFounder();
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, { contactId: founder, objective: refOf(objective), ask: ASK_TESTS_UNKNOWN }),
    });
    return { objective, dispatch, launchId, proposal };
  }

  it("revokes approved, unmaterialized proposals once per change and lists what changed", async () => {
    const fixture = await newFixture();
    const { launchId, proposal, dispatch } = await savedBriefRun(fixture);
    const resolve = async () => fixture.workspace;
    markApproved(proposal.id);

    // Unchanged sources: nothing to revoke.
    expect(await observeObjectiveSources(launchId, resolve)).toEqual({
      objectiveSource: { status: "current", changedPaths: [], observedAt: expect.any(Number) },
      revokedVariantIds: [],
    });
    // Another product's entry changing is not this run's source.
    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE.replace("## 2. Bare Offering", "## 2. Bare Offering, renamed"));
    expect((await observeObjectiveSources(launchId, resolve))?.revokedVariantIds).toEqual([]);

    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), PRODUCTS_FIXTURE.replace("Terminals and browsers.", "Terminals, browsers and worktrees."));
    writeFileSync(join(fixture.workspace.dir, "objectives", "eng-founders.md"), `${COMMERCIAL_BRIEF}\nEdited later.`);
    const changed = await observeObjectiveSources(launchId, resolve);
    expect(changed).toEqual({
      objectiveSource: {
        status: "stale",
        changedPaths: ["objectives/eng-founders.md", "PRODUCTS.md#engineering-workflow"],
        observedAt: expect.any(Number),
      },
      revokedVariantIds: [proposal.id],
    });
    expect(writingOf(proposal.id).approval).toMatchObject({ state: "revoked", revokedReason: "objective_source_stale" });

    // The same change does not revoke again: a fresh approval after the observation stands.
    markApproved(proposal.id);
    const again = await observeObjectiveSources(launchId, resolve);
    expect(again).toMatchObject({ objectiveSource: { status: "stale" }, revokedVariantIds: [] });
    expect(writingOf(proposal.id).approval).toMatchObject({ state: "approved" });

    // The run projection reports the last observation.
    expect(listWorkflowRunProposals(dispatch.run.id).objectiveSource).toMatchObject({
      status: "stale",
      changedPaths: ["objectives/eng-founders.md", "PRODUCTS.md#engineering-workflow"],
    });

    // A source that can no longer be read is a change too.
    rmSync(join(fixture.workspace.dir, "objectives", "eng-founders.md"));
    const removed = await observeObjectiveSources(launchId, resolve);
    expect(removed).toMatchObject({ revokedVariantIds: [proposal.id] });
  });

  it("sees an edit past the excerpt cutoff of the referenced entry, and only that entry (Review #549 F1)", async () => {
    const fixture = await newFixture();
    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), bigProductsFixture());
    const objective = await normalizeAccountObjective({
      raw: { kind: "commercial", brief: { kind: "inline", text: "## Outcome\nEvaluate @PRODUCTS.md#big-offering.\n## Fit\nFounders.\n## Success\nA reply." } },
      source: "run_config",
      resolveWorkspace: async () => fixture.workspace,
    });
    if (!objective.ok) throw new Error(objective.reason);
    expect(objective.objective.offering).toMatchObject({ slug: "big-offering", proofPointCount: 1 });
    const dispatch = objectiveRun(objective.objective);
    const launchId = await composedLaunch(dispatch);
    const proposal = await propose(fixture, {
      launchId,
      workflowRunId: dispatch.run.id,
      intent: objectiveIntent(dispatch, { contactId: syntheticFounder(), objective: refOf(objective.objective), ask: { statement: "Propose the evaluation.", relation: "advances", customerPain: { status: "none_assumed" } } }),
    });
    markApproved(proposal.id);
    const resolve = async () => fixture.workspace;

    // Another entry changing is not this run's source.
    writeFileSync(join(fixture.workspace.dir, "PRODUCTS.md"), bigProductsFixture().replace("Terminals and browsers.", "Terminals only."));
    expect(await observeObjectiveSources(launchId, resolve)).toMatchObject({
      objectiveSource: { status: "current", changedPaths: [] },
      revokedVariantIds: [],
    });

    // Replace the proof point and add one, all past the 8 KiB excerpt the snapshot shows.
    writeFileSync(
      join(fixture.workspace.dir, "PRODUCTS.md"),
      bigProductsFixture(["- **Proven:** A replaced proof point.", "- **Also:** Another proof point."]).replace("Terminals and browsers.", "Terminals only."),
    );
    expect(await observeObjectiveSources(launchId, resolve)).toEqual({
      objectiveSource: { status: "stale", changedPaths: ["PRODUCTS.md#big-offering"], observedAt: expect.any(Number) },
      revokedVariantIds: [proposal.id],
    });
    expect(writingOf(proposal.id).approval).toMatchObject({ state: "revoked", revokedReason: "objective_source_stale" });
  });

  it("revokes nothing and records nothing when the workspace cannot be resolved", async () => {
    const fixture = await newFixture();
    const { launchId, proposal } = await savedBriefRun(fixture);
    markApproved(proposal.id);
    writeFileSync(join(fixture.workspace.dir, "objectives", "eng-founders.md"), "## Outcome\nChanged.");
    const before = db.select().from(launches).where(eq(launches.id, launchId)).get()!.metadata;

    const observation = await observeObjectiveSources(launchId, async () => {
      throw new Error("workspace unavailable");
    });
    expect(observation).toEqual({
      objectiveSource: { status: "unavailable", changedPaths: [], observedAt: expect.any(Number) },
      revokedVariantIds: [],
    });
    expect(writingOf(proposal.id).approval).toMatchObject({ state: "approved" });
    expect(db.select().from(launches).where(eq(launches.id, launchId)).get()!.metadata).toBe(before);
  });

  it("leaves a materialized proposal alone", async () => {
    const fixture = await newFixture();
    const { launchId, proposal } = await savedBriefRun(fixture);
    const materialized = await approve(fixture, proposal.id);
    writeFileSync(join(fixture.workspace.dir, "objectives", "eng-founders.md"), "## Outcome\nChanged.");

    expect(await observeObjectiveSources(launchId, async () => fixture.workspace))
      .toMatchObject({ objectiveSource: { status: "stale" }, revokedVariantIds: [] });
    expect(writingOf(proposal.id).approval).toMatchObject({ state: "approved" });
    expect(getContentItem(materialized.contentItemId)?.status).toBe("approved");
  });

  it("strips a caller-supplied observation and keeps the server's", async () => {
    const fixture = await newFixture();
    const { launchId, dispatch } = await savedBriefRun(fixture);
    await invokeAgentTool("upsert_launch", {
      id: launchId,
      name: `Nurture proposals ${dispatch.run.id}`,
      metadata: {
        writing: {
          schemaVersion: 1,
          objectiveState: { observedSourceHash: "forged", observedAt: 1, status: "current", changedPaths: [] },
        },
      },
    });
    const state = JSON.parse(db.select().from(launches).where(eq(launches.id, launchId)).get()!.metadata ?? "{}").writing.objectiveState;
    expect(state.observedSourceHash).not.toBe("forged");
    expect(state.observedSourceHash).toBe(launchCompositionOf(launchId)!.objective && (launchCompositionOf(launchId)!.objective as AccountObjective).sourceHash);
  });
});
