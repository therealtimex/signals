import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import {
  assertWritingIntentAuthority,
  resolveComposedRunAuthority,
} from "@/lib/writing/writing-intent-authority";
import { buildWritingIntentDraft, toWritingIntentRecord } from "@/lib/writing/writing-intent";
import { resetCoreTables } from "@/test/db";

function nurtureTemplate() {
  return createTemplate({
    name: "Contact Relationship Nurture",
    templateType: "nurture",
    status: "active",
    config: JSON.stringify(buildContactNurtureTemplateConfig()),
    isSystem: 1,
  });
}

function intent(overrides: {
  workflowRunId: string;
  templateId: string;
  surface?: "x/reply" | "x/direct_message";
  targetId?: string | null;
}) {
  return toWritingIntentRecord({
    ...buildWritingIntentDraft({
      intentId: "wint_authority1",
      consumer: "contact_relationship_nurture",
      lineage: { workflowRunId: overrides.workflowRunId, templateId: overrides.templateId },
      recipient: { kind: "contact", contactId: "contact_1", platform: "x" },
      goal: { relationshipGoal: "follow_back", writingGoal: "follows" },
      target: {
        platform: "x",
        // `??` would swallow an explicit null, which is one of the cases under test.
        targetId: "targetId" in overrides ? overrides.targetId! : "tgt_acting",
      },
      surface: overrides.surface ?? "x/reply",
      sourceRefs: [],
    }),
    bindingId: "unused",
  });
}

describe("composed run authority", () => {
  beforeEach(() => resetCoreTables());

  it("reads the composition off the run row the dispatcher wrote", () => {
    const template = nurtureTemplate();
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "agent",
      config: JSON.stringify(buildContactNurtureTemplateConfig()),
    });

    expect(resolveComposedRunAuthority(db, run.id)).toMatchObject({
      workflowRunId: run.id,
      templateId: template.id,
      composition: { consumer: "contact_relationship_nurture", mandate: "assist_only" },
    });
  });

  it("falls back to the template when the run config predates the opt-in", () => {
    const template = nurtureTemplate();
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "agent",
      config: JSON.stringify({ maxTargets: 3 }),
    });

    expect(resolveComposedRunAuthority(db, run.id)?.composition.consumer).toBe(
      "contact_relationship_nurture",
    );
  });

  it("treats an uncomposed or unknown run as not composed", () => {
    const template = createTemplate({
      name: "Ad-hoc",
      templateType: "content",
      status: "active",
      config: JSON.stringify({}),
    });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "agent",
      config: JSON.stringify({}),
    });

    expect(resolveComposedRunAuthority(db, run.id)).toBeNull();
    expect(resolveComposedRunAuthority(db, "run_does_not_exist")).toBeNull();
  });
});

describe("assertWritingIntentAuthority", () => {
  /** The shape `mergeLaunchMetadata` stamps onto a launch. */
  const composed = {
    schemaVersion: 1 as const,
    workflowRunId: "run_1",
    templateId: "tpl_1" as string | null,
    consumer: "contact_relationship_nurture",
    mandate: "assist_only" as const,
    surfaces: ["x/reply" as const],
    stampedAt: 1_700_000_000,
  };
  const base = {
    workflowRunId: "run_1",
    surface: "x/reply" as const,
    platform: "x",
    targetId: "tgt_acting" as string | null,
  };
  const valid = intent({ workflowRunId: "run_1", templateId: "tpl_1" });

  it("passes an intent that matches the launch scope", () => {
    expect(
      assertWritingIntentAuthority({ ...base, composition: composed, intent: valid }),
    ).toMatchObject({ consumer: "contact_relationship_nurture", surface: "x/reply" });
  });

  it("returns null for an ordinary surface on an unscoped launch", () => {
    const ordinary = { ...base, surface: "x/post" as const, composition: null };
    expect(assertWritingIntentAuthority({ ...ordinary, intent: undefined })).toBeNull();
    expect(assertWritingIntentAuthority({ ...ordinary, intent: null })).toBeNull();
  });

  it("refuses an assist-only surface outside any composed scope", () => {
    for (const surface of ["x/reply", "x/direct_message"] as const) {
      expect(() =>
        assertWritingIntentAuthority({ ...base, surface, composition: null, intent: undefined }),
      ).toThrowError(
        expect.objectContaining({
          details: expect.objectContaining({ reason: "composed_scope_required" }),
        }),
      );
    }
  });

  const cases: [string, { composition: typeof composed | null; intent: unknown }][] = [
    ["writing_intent_not_permitted", { composition: null, intent: valid }],
    ["writing_intent_required", { composition: composed, intent: undefined }],
    ["writing_intent_invalid", { composition: composed, intent: { mandate: "assist_only" } }],
    // An unregistered consumer never becomes a valid record in the first place.
    ["writing_intent_invalid", { composition: composed, intent: { ...valid, consumer: "other" } }],
    [
      "writing_intent_surface_mismatch",
      { composition: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", surface: "x/direct_message" }) },
    ],
    [
      "writing_intent_lineage_mismatch",
      { composition: composed, intent: intent({ workflowRunId: "run_other", templateId: "tpl_1" }) },
    ],
    [
      "writing_intent_lineage_mismatch",
      { composition: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_other" }) },
    ],
    [
      "writing_intent_target_mismatch",
      { composition: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", targetId: null }) },
    ],
    [
      "writing_intent_target_mismatch",
      { composition: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", targetId: "tgt_other" }) },
    ],
  ];

  it.each(cases)("fails closed with %s", (reason, override) => {
    expect(() => assertWritingIntentAuthority({ ...base, ...override })).toThrowError(
      expect.objectContaining({ details: expect.objectContaining({ reason }) }),
    );
  });

  it("rejects a generation pointer that disagrees with the launch scope", () => {
    expect(() =>
      assertWritingIntentAuthority({
        ...base,
        workflowRunId: "run_tampered",
        composition: composed,
        intent: valid,
      }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "writing_intent_lineage_mismatch" }),
      }),
    );
  });

  it("rejects a valid intent belonging to a different registered consumer", () => {
    // Unreachable while `WRITING_INTENT_CONSUMERS` has one entry; the cast keeps the guard live so
    // adding a second consumer cannot silently let its proposals ride another scope.
    expect(() =>
      assertWritingIntentAuthority({
        ...base,
        composition: { ...composed, consumer: "social_intent_patrol" },
        intent: valid,
      }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "writing_intent_consumer_mismatch" }),
      }),
    );
  });

  it("rejects a surface the scope does not enable", () => {
    expect(() =>
      assertWritingIntentAuthority({
        ...base,
        surface: "x/post",
        composition: composed,
        intent: intent({ workflowRunId: "run_1", templateId: "tpl_1" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "writing_intent_surface_mismatch" }),
      }),
    );
  });
});
