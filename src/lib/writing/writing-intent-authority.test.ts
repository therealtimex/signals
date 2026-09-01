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
  const authority = {
    workflowRunId: "run_1",
    templateId: "tpl_1",
    composition: {
      version: 1 as const,
      consumer: "contact_relationship_nurture" as const,
      surfaces: ["x/reply"] as const,
      mandate: "assist_only" as const,
      approvalPolicy: "explicit" as const,
    },
  };
  const base = {
    workflowRunId: "run_1",
    surface: "x/reply" as const,
    platform: "x",
    targetId: "tgt_acting" as string | null,
  };
  const valid = intent({ workflowRunId: "run_1", templateId: "tpl_1" });

  it("passes an intent that matches the dispatch", () => {
    expect(
      assertWritingIntentAuthority({ ...base, authority: { ...authority, composition: { ...authority.composition, surfaces: [...authority.composition.surfaces] } }, intent: valid }),
    ).toMatchObject({ consumer: "contact_relationship_nurture", surface: "x/reply" });
  });

  it("returns null for an ordinary surface and run with no intent", () => {
    const ordinary = { ...base, surface: "x/post" as const };
    expect(assertWritingIntentAuthority({ ...ordinary, authority: null, intent: undefined })).toBeNull();
    expect(assertWritingIntentAuthority({ ...ordinary, authority: null, intent: null })).toBeNull();
  });

  it("requires an intent on an assist-only surface even when the named run is ordinary", () => {
    // The bypass Review found: name any uncomposed run and omit the intent. The surface refuses.
    for (const surface of ["x/reply", "x/direct_message"] as const) {
      expect(() =>
        assertWritingIntentAuthority({ ...base, surface, authority: null, intent: undefined }),
      ).toThrowError(
        expect.objectContaining({
          details: expect.objectContaining({ reason: "writing_intent_required" }),
        }),
      );
    }
  });

  const composed = {
    ...authority,
    composition: { ...authority.composition, surfaces: [...authority.composition.surfaces] },
  };

  const cases: [string, { authority: typeof composed | null; intent: unknown }][] = [
    ["writing_intent_not_permitted", { authority: null, intent: valid }],
    ["writing_intent_required", { authority: composed, intent: undefined }],
    ["writing_intent_invalid", { authority: composed, intent: { mandate: "assist_only" } }],
    // An unregistered consumer never becomes a valid record in the first place.
    ["writing_intent_invalid", { authority: composed, intent: { ...valid, consumer: "other" } }],
    [
      "writing_intent_surface_mismatch",
      { authority: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", surface: "x/direct_message" }) },
    ],
    [
      "writing_intent_lineage_mismatch",
      { authority: composed, intent: intent({ workflowRunId: "run_other", templateId: "tpl_1" }) },
    ],
    [
      "writing_intent_lineage_mismatch",
      { authority: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_other" }) },
    ],
    [
      "writing_intent_target_mismatch",
      { authority: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", targetId: null }) },
    ],
    [
      "writing_intent_target_mismatch",
      { authority: composed, intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", targetId: "tgt_other" }) },
    ],
  ];

  it.each(cases)("fails closed with %s", (reason, override) => {
    expect(() => assertWritingIntentAuthority({ ...base, ...override })).toThrowError(
      expect.objectContaining({ details: expect.objectContaining({ reason }) }),
    );
  });

  it("rejects a valid intent belonging to a different registered consumer", () => {
    // Unreachable while `WRITING_INTENT_CONSUMERS` has one entry; the cast keeps the guard live so
    // adding a second consumer cannot silently let its proposals ride another workflow's run.
    const otherConsumer = {
      ...composed,
      composition: { ...composed.composition, consumer: "social_intent_patrol" as never },
    };
    expect(() =>
      assertWritingIntentAuthority({ ...base, authority: otherConsumer, intent: valid }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "writing_intent_consumer_mismatch" }),
      }),
    );
  });

  it("rejects a surface the composition does not enable", () => {
    const narrowed = {
      ...composed,
      composition: { ...composed.composition, surfaces: ["x/direct_message" as const] },
    };
    expect(() =>
      assertWritingIntentAuthority({
        ...base,
        surface: "x/direct_message",
        authority: narrowed,
        intent: intent({ workflowRunId: "run_1", templateId: "tpl_1", surface: "x/reply" }),
      }),
    ).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "writing_intent_surface_mismatch" }),
      }),
    );
  });
});
