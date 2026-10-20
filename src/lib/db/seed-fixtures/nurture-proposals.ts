import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contentItems,
  contacts,
  graphEdges,
  launches,
  variants,
  workflowRuns,
} from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { getLaunchById } from "@/lib/db/queries/launches";
import { listPlatformTargets } from "@/lib/db/queries/platform-targets";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { getPersonalityBindingView } from "@/lib/personality/status";
import type { PersonalityStatusDependencies } from "@/lib/personality/status";
import type { PersonalityGuardDependencies } from "@/lib/writing/personality-guard";
import {
  buildContactNurtureRunConfig,
  CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME,
  type ContactNurtureConfig,
} from "@/lib/workflows/contact-relationship-nurture";
import { resolveNurtureApprovalGate } from "@/lib/workflows/nurture-approval-gate";
import { buildWritingUnits } from "@/lib/writing/content-writing";
import { hardLimit } from "@/lib/writing/variant-writing";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import {
  buildWritingIntentDraft,
  toWritingIntentRecord,
  type WritingIntentAsk,
} from "@/lib/writing/writing-intent";
import {
  ACCOUNT_OBJECTIVE_CONFIG_KEY,
  normalizeAccountObjective,
  type AccountObjective,
} from "@/lib/writing/account-objective";
import { resolvePersonalityWorkspace } from "@/lib/personality/workspace";
import {
  mintWritingScopeToken,
  WRITING_SCOPE_TOKEN_CONFIG_KEY,
} from "@/lib/writing/writing-scope-token";
import { listWorkflowRunProposals } from "@/lib/writing/workflow-run-proposals";

export type NurtureProposalFixtureResult = {
  ok: true;
  fixture: "nurture-proposals";
  label: string;
  templateId: string;
  targetId: string;
  workflowRunId: string;
  launchId: string;
  launchIds: string[];
  variantIds: string[];
  contactIds: string[];
};

/**
 * Run objective the fixture stamps (#549). `none` keeps the #413 shape: a run from before account
 * objectives, which renders no objective block and no Ask box.
 */
export type NurtureProposalFixtureObjective = "none" | "commercial" | "relationship_only";

type FixtureOptions = {
  label?: string;
  objective?: NurtureProposalFixtureObjective;
  /** PRODUCTS.md entry the commercial brief mentions; omitted → the `offering_missing` limitation. */
  offeringSlug?: string;
  dependencies?: PersonalityGuardDependencies & Pick<
    PersonalityStatusDependencies,
    "probeCapability" | "listTargets"
  >;
};

function fixtureError(reasons: string[]): never {
  const error = new Error(`fixture_precondition_unmet: ${reasons.join("; ")}`);
  Object.assign(error, { code: "fixture_precondition_unmet", reasons });
  throw error;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanupPriorFixture(label: string): void {
  const fixtureTag = `fixture:nurture-proposals:${label}`;
  const priorContacts = db.select({ id: contacts.id }).from(contacts)
    .where(eq(contacts.tags, fixtureTag)).all();
  const contactIds = priorContacts.map((contact) => contact.id);
  const priorRuns = db.select().from(workflowRuns).all().filter((run) =>
    object(object(run.config).experienceFixture).label === label,
  );
  if (priorRuns.length === 0 && contactIds.length === 0) return;
  const runIds = priorRuns.map((run) => run.id);
  const priorLaunches = db.select().from(launches).all().filter((launch) => {
    const composition = object(object(launch.metadata).writing).composition;
    return runIds.includes(String(object(composition).workflowRunId ?? ""));
  });
  const launchIds = priorLaunches.map((launch) => launch.id);
  const priorVariants = launchIds.length
    ? db.select().from(variants).where(inArray(variants.launchId, launchIds)).all()
    : [];
  const variantIds = priorVariants.map((variant) => variant.id);
  const contentIds = priorVariants.flatMap((variant) => variant.contentItemId ? [variant.contentItemId] : []);
  db.transaction((tx) => {
    if (variantIds.length) {
      tx.delete(graphEdges).where(and(
        eq(graphEdges.srcType, "variant"),
        inArray(graphEdges.srcId, variantIds),
      )).run();
    }
    if (contentIds.length) {
      tx.delete(graphEdges).where(and(
        eq(graphEdges.dstType, "content"),
        inArray(graphEdges.dstId, contentIds),
      )).run();
    }
    if (contactIds.length) {
      tx.delete(graphEdges).where(and(
        eq(graphEdges.srcType, "contact"),
        inArray(graphEdges.srcId, contactIds),
      )).run();
      tx.delete(graphEdges).where(and(
        eq(graphEdges.dstType, "contact"),
        inArray(graphEdges.dstId, contactIds),
      )).run();
    }
    if (launchIds.length) tx.delete(launches).where(inArray(launches.id, launchIds)).run();
    if (contentIds.length) tx.delete(contentItems).where(inArray(contentItems.id, contentIds)).run();
    if (runIds.length) tx.delete(workflowRuns).where(inArray(workflowRuns.id, runIds)).run();
    if (contactIds.length) tx.delete(contacts).where(inArray(contacts.id, contactIds)).run();
  });
}

function launchPayload(input: {
  runId: string;
  targetId: string;
  token: string;
  label: string;
}) {
  const source = {
    id: "src_experience1",
    kind: "note" as const,
    text: "A considerate relationship touchpoint grounded in the contact record.",
    enteredAt: 10,
    sensitivity: { level: "public" as const, reason: "public_default" as const },
  };
  return {
    name: `Contact Relationship Nurture · ${input.label}`,
    writingScopeToken: input.token,
    metadata: {
      writing: {
        schemaVersion: 1,
        goal: "replies",
        surfaces: [
          { platform: "x", surface: "x/reply", targetId: input.targetId },
          { platform: "x", surface: "x/direct_message", targetId: input.targetId },
        ],
        sources: [source],
        spine: {
          schemaVersion: 1,
          id: "spn_experience1",
          launchId: "server-stamped",
          goal: "replies",
          audience: { nicheIds: [] },
          sources: [source],
          claims: [{
            id: "clm_experience1",
            kind: "fact",
            text: source.text,
            sourceId: source.id,
            verbatimRequired: false,
            sensitivity: "public",
            includeInOutput: true,
          }],
          message: {
            core: source.text,
            supporting: [],
            proofClaimIds: ["clm_experience1"],
          },
          extractedBy: { workflowRunId: input.runId, at: 10 },
          hash: "server-replaces-this",
        },
        voiceProfile: null,
        voicePrecedence: "voice_first",
        approvalPolicy: "explicit",
        runs: [{ workflowRunId: input.runId, mode: "draft", startedAt: 10 }],
      },
    },
  };
}

/** A synthetic commercial brief: the spec §11 engineering-workflow case, no real names. */
function fixtureBrief(offeringSlug: string | undefined): string {
  const offering = offeringSlug ? `@PRODUCTS.md#${offeringSlug}` : "our engineering workflow";
  return [
    "## Outcome",
    `Agree to a 20-minute evaluation of ${offering}.`,
    "",
    "## Fit",
    "Technical founders hiring engineers onto a growing codebase.",
    "",
    "## Unknowns",
    "- Whether they use a coding agent today",
    "- Who owns onboarding for new engineers",
    "",
    "## Next step",
    "Ask which workflow they use to onboard new engineers.",
    "",
    "## Success",
    "A reply that names their current onboarding workflow.",
  ].join("\n");
}

/** One ask per proposal, covering each relation and customer-pain state the card renders. */
function fixtureAsk(objective: AccountObjective, index: number): WritingIntentAsk {
  if (objective.kind === "relationship_only") {
    return {
      statement: "Keep the conversation warm with a specific, low-effort question.",
      relation: "relationship_only",
      customerPain: { status: "none_assumed" },
    };
  }
  return [
    {
      statement: "Ask how they get new engineers productive in their first week.",
      relation: "tests" as const,
      testsUncertainty: 1,
      customerPain: { status: "evidenced" as const, claimIds: ["clm_experience1"] },
    },
    {
      statement: "Offer to compare notes on onboarding workflows.",
      relation: "advances" as const,
      customerPain: { status: "asked" as const, text: "Is onboarding new engineers slower than you want?" },
    },
    {
      statement: "Congratulate the launch without an ask.",
      relation: "defers" as const,
      deferReason: "A recent touch already asked a question; this keeps the thread warm first.",
      customerPain: { status: "none_assumed" as const },
    },
  ][index % 3];
}

function variantPayload(input: {
  index: number;
  objective: AccountObjective | null;
  runId: string;
  templateId: string;
  launchId: string;
  bindingId: string;
  targetId: string;
  contactId: string;
  relationshipGoal: "follow_back" | "mutual_engagement" | "warm_conversation";
  surface: "x/reply" | "x/direct_message";
  body: string;
}) {
  const launch = getLaunchById(input.launchId)!;
  const spine = object(object(launch.metadata).writing).spine as { id: string; hash: string };
  const writingGoal = input.relationshipGoal === "follow_back" ? "follows" : "replies";
  const intent = toWritingIntentRecord({
    ...buildWritingIntentDraft({
      intentId: `wint_experience${input.index + 1}`,
      consumer: "contact_relationship_nurture",
      lineage: {
        workflowRunId: input.runId,
        templateId: input.templateId,
        templateName: CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME,
      },
      recipient: {
        kind: "contact",
        contactId: input.contactId,
        platform: "x",
        handle: `experience_contact_${input.index + 1}`,
      },
      goal: { relationshipGoal: input.relationshipGoal, writingGoal },
      target: { platform: "x", targetId: input.targetId },
      surface: input.surface,
      sourceRefs: [{ kind: "contact_record", contactId: input.contactId }],
      ...(input.objective
        ? {
            objective: { objectiveId: input.objective.objectiveId, hash: input.objective.hash },
            ask: fixtureAsk(input.objective, input.index),
          }
        : {}),
    }),
    bindingId: input.bindingId,
  });
  return {
    launchId: input.launchId,
    label: `Proposal ${input.index + 1}`,
    generationMetadata: {
      schemaVersion: 1,
      kind: "signals-writing",
      mode: "draft",
      model: "experience-fixture",
      skill: { name: "signals-writing", version: "1.1.0" },
      agent: { workflowRunId: input.runId },
      requestHash: `experience-${input.runId}-${input.index + 1}`,
      generatedAt: 20 + input.index,
    },
    metadata: {
      writing: {
        schemaVersion: 1,
        platform: "x",
        surface: input.surface,
        targetId: input.targetId,
        goal: writingGoal,
        formulaId: `${input.surface}/experience@1`,
        overlay: { id: "overlay:x", version: 1 },
        core: { version: 1 },
        voiceProfile: null,
        voicePrecedence: "voice_first",
        spine: { id: spine.id, hash: spine.hash },
        units: buildWritingUnits([input.body]),
        claimMap: [{ claimId: "clm_experience1", present: true, unit: 0 }],
        audit: {
          schemaVersion: 1,
          auditedAt: 20 + input.index,
          auditor: { kind: "agent", skillVersion: "1.1.0", workflowRunId: input.runId },
          overlay: { id: "overlay:x", version: 1 },
          core: { version: 1 },
          verdict: "pass",
          findings: [],
          claims: {
            total: 1,
            preserved: 1,
            altered: [],
            missing: [],
            invented: [],
            privateIncluded: [],
          },
          hard: {
            units: 1,
            chars: [input.body.length],
            limit: hardLimit(input.surface),
            hashtags: 0,
            links: 0,
            mediaCount: 0,
          },
          voice: { status: "none", skipped: [] },
          heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
        },
        lineage: { sourceIds: ["src_experience1"] },
        personality: { bindingId: input.bindingId },
        intent,
      },
    },
  };
}

export async function seedNurtureProposalFixture(
  options: FixtureOptions = {},
): Promise<NurtureProposalFixtureResult> {
  const label = options.label?.trim() || "issue-413";
  const template = getSystemTemplateByName(CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME);
  const personality = await getPersonalityBindingView(options.dependencies);
  const binding = personality.status.binding;
  const target = listPlatformTargets({ platform: "x" }).find((candidate) =>
    personality.status.compatibleTargets.includes(candidate.id),
  );
  const reasons = [
    ...(!template ? ["install or seed the Contact Relationship Nurture system template"] : []),
    ...(!binding || !["bound", "source_stale"].includes(personality.status.status)
      ? ["bind the Signals workspace Personality before seeding proposals"]
      : []),
    ...(!target ? ["register an active X acting target represented by that Personality"] : []),
  ];
  if (reasons.length || !template || !binding || !target) fixtureError(reasons);
  cleanupPriorFixture(label);

  const goals = ["follow_back", "mutual_engagement", "warm_conversation"] as const;
  const contacts = goals.map((relationshipGoal, index) => createContact({
    name: `Experience Contract Contact ${index + 1}`,
    tags: `fixture:nurture-proposals:${label}`,
    relationshipGoal,
    relationshipGoalStatus: "not_started",
  }, "agent:create_contact"));
  const config: ContactNurtureConfig = {
    targetId: target.id,
    relationshipGoalFilter: "all",
    maxTargets: 3,
    maxActionsPerRun: 3,
    delayBetweenActionsSeconds: 30,
    requireApproval: true,
    autoAchieveOnMilestone: true,
  };
  let runtimeConfig: Record<string, unknown> = {
    ...buildContactNurtureRunConfig(config),
    templateName: template.name,
    approvalGate: resolveNurtureApprovalGate("x"),
    rtxWorkspaceSlug: "signals-issue-413-qa",
    rtxThreadSlug: `fixture-${label.replace(/[^A-Za-z0-9_-]/g, "-")}`,
    experienceFixture: { name: "nurture-proposals", label },
  };
  const objectiveKind = options.objective ?? "none";
  let objective: AccountObjective | null = null;
  if (objectiveKind !== "none") {
    const normalized = await normalizeAccountObjective({
      raw: objectiveKind === "commercial"
        ? { kind: "commercial", brief: { kind: "inline", text: fixtureBrief(options.offeringSlug) } }
        : { kind: "relationship_only" },
      source: "run_config",
      resolveWorkspace: options.dependencies?.resolveWorkspace ?? (() => resolvePersonalityWorkspace()),
    });
    if (!normalized.ok) fixtureError([`account objective refused: ${normalized.reason}`]);
    objective = normalized.objective;
    runtimeConfig = { ...runtimeConfig, [ACCOUNT_OBJECTIVE_CONFIG_KEY]: objective };
  }
  const now = Math.floor(Date.now() / 1_000);
  const run = createWorkflowRun({
    templateId: template.id,
    workflowType: "agent",
    status: "completed",
    totalItems: 3,
    processedItems: 3,
    successItems: 3,
    startedAt: now - 10,
    completedAt: now,
    config: JSON.stringify(runtimeConfig),
  });
  const scope = mintWritingScopeToken(run.id);
  db.update(workflowRuns).set({
    config: JSON.stringify({
      ...runtimeConfig,
      [WRITING_SCOPE_TOKEN_CONFIG_KEY]: scope.tokenHash,
    }),
  }).where(eq(workflowRuns.id, run.id)).run();
  const launch = await invokeAgentTool("upsert_launch", launchPayload({
    runId: run.id,
    targetId: target.id,
    token: scope.token,
    label,
  })) as { id: string };
  const bodies = [
    "Your recent launch made the hard tradeoff unusually clear. Which signal changed your mind?",
    "The way you separated customer evidence from roadmap pressure was useful. I would love to compare notes.",
    "Your product launch is a strong fit for a conversation we are having about durable customer signals. Open to a short exchange?",
  ];
  const variantIds: string[] = [];
  for (let index = 0; index < contacts.length; index += 1) {
    const variant = await upsertVariantUseCase(variantPayload({
      index,
      objective,
      runId: run.id,
      templateId: template.id,
      launchId: launch.id,
      bindingId: binding.id,
      targetId: target.id,
      contactId: contacts[index].id,
      relationshipGoal: goals[index],
      surface: index === 2 ? "x/direct_message" : "x/reply",
      body: bodies[index],
    }), options.dependencies);
    variantIds.push(variant.id);
  }
  const proposals = listWorkflowRunProposals(run.id);
  if (proposals.summary.pendingReview !== 3) {
    throw new Error(`fixture_precondition_unmet: expected 3 pending proposals, got ${proposals.summary.pendingReview}`);
  }
  return {
    ok: true,
    fixture: "nurture-proposals",
    label,
    templateId: template.id,
    targetId: target.id,
    workflowRunId: run.id,
    launchId: launch.id,
    launchIds: [launch.id],
    variantIds,
    contactIds: contacts.map((contact) => contact.id),
  };
}
