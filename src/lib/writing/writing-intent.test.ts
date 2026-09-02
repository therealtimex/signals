import { describe, expect, it } from "vitest";
import { PRESENCE_MANDATE_MODES } from "@/lib/personality/contracts";
import { getSurfaceCapabilities } from "@/lib/writing/capabilities";
import {
  NURTURE_WRITING_SURFACES,
  WRITING_INTENT_ACTIONS,
  WRITING_INTENT_APPROVAL_POLICY,
  WRITING_INTENT_CONSUMERS,
  WRITING_INTENT_MANDATES,
  WRITING_INTENT_PERSONALITY_SUBMISSION_KEYS,
  WRITING_INTENT_RECIPIENT_KEYS,
  writingIntentRecipientSchema,
  buildWritingIntentDraft,
  isAssistOnlyIntent,
  readWritingIntentRecord,
  resolveWritingRequest,
  toWritingIntentRecord,
  writingIntentDraftSchema,
  writingIntentSchema,
  type WritingIntent,
  type WritingIntentContext,
} from "@/lib/writing/writing-intent";

const draft = buildWritingIntentDraft({
  intentId: "wint_abcdef1",
  consumer: "contact_relationship_nurture",
  lineage: { workflowRunId: "run_1", templateId: "tpl_1", templateName: "Contact Relationship Nurture" },
  recipient: { kind: "contact", contactId: "contact_1", platform: "x", handle: "someone" },
  goal: { relationshipGoal: "follow_back", writingGoal: "follows" },
  target: { platform: "x", targetId: "tgt_1" },
  surface: "x/reply",
  replyContext: { kind: "post", url: "https://x.com/someone/status/1" },
  sourceRefs: [{ kind: "contact_record", contactId: "contact_1" }],
});

const intent: WritingIntent = { ...draft, bindingId: "pb_active" };

const boundContext: WritingIntentContext = {
  personalityStatus: "bound",
  hostCapability: "available",
  targetCompatible: true,
};

describe("writing intent contract", () => {
  it("pins one mandate, matching the dormant presence mandate", () => {
    expect(WRITING_INTENT_MANDATES).toEqual(["assist_only"]);
    expect(WRITING_INTENT_MANDATES).toEqual(PRESENCE_MANDATE_MODES);
    expect(WRITING_INTENT_ACTIONS).toEqual(["draft", "audit", "propose"]);
    expect(WRITING_INTENT_ACTIONS as readonly string[]).not.toContain("publish");
    expect(WRITING_INTENT_ACTIONS as readonly string[]).not.toContain("send");
    expect(WRITING_INTENT_APPROVAL_POLICY).toBe("explicit");
  });

  it("allows a workflow to submit exactly one Personality field", () => {
    expect(WRITING_INTENT_PERSONALITY_SUBMISSION_KEYS).toEqual(["bindingId"]);
    const request = resolveWritingRequest(intent, boundContext);
    expect(request.lane).toBe("full");
    if (request.lane !== "full") return;
    expect(Object.keys(request.personalitySubmission)).toEqual(["bindingId"]);
    expect(request.personalitySubmission.bindingId).toBe("pb_active");
  });

  it("rejects any Personality field beyond the binding", () => {
    for (const extra of [
      { personalityHash: "a".repeat(64) },
      { workspaceSlug: "signals" },
      { identity: { selfContactId: "contact_self", representedOrgId: null } },
      { personality: { bindingId: "pb_active" } },
    ]) {
      expect(writingIntentSchema.safeParse({ ...intent, ...extra }).success).toBe(false);
    }
  });

  it("keeps contact prose out of the intent: references only", () => {
    expect(Object.keys(writingIntentRecipientSchema.shape).sort()).toEqual(
      [...WRITING_INTENT_RECIPIENT_KEYS].sort(),
    );
    expect(
      writingIntentSchema.safeParse({
        ...intent,
        recipient: {
          ...intent.recipient,
          personaSummary: "Loves distributed systems and hates cold outreach",
        },
      }).success,
    ).toBe(false);
  });

  it("refuses a surface the consumer is not allowed to write on", () => {
    expect(
      writingIntentDraftSchema.safeParse({ ...draft, surface: "x/post" }).success,
    ).toBe(false);
    expect(
      writingIntentDraftSchema.safeParse({
        ...draft,
        surface: "linkedin/comment",
        target: { platform: "x", targetId: "tgt_1" },
      }).success,
    ).toBe(false);
  });

  it("fails closed on every unusable Personality or target state", () => {
    const cases: [Partial<WritingIntentContext>, string][] = [
      [{ hostCapability: "unavailable" }, "personality_host_unavailable"],
      [{ hostCapability: "unknown" }, "personality_host_unavailable"],
      [{ personalityStatus: "unavailable" }, "personality_workspace_unavailable"],
      [{ personalityStatus: "drifted" }, "personality_drifted"],
      [{ personalityStatus: "unbound" }, "personality_unbound"],
      [{ targetCompatible: false }, "target_identity_mismatch"],
    ];
    for (const [override, reason] of cases) {
      const request = resolveWritingRequest(intent, { ...boundContext, ...override });
      expect(request.lane).toBe("refused");
      if (request.lane !== "refused") continue;
      expect(request.reason).toBe(reason);
    }
  });

  it("refuses an intent that does not parse rather than drafting from it", () => {
    const request = resolveWritingRequest({ ...intent, bindingId: "" }, boundContext);
    expect(request).toEqual({ lane: "refused", intent: null, reason: "invalid_intent" });
  });

  it("drafts on source_stale and carries the warning forward", () => {
    const request = resolveWritingRequest(intent, {
      ...boundContext,
      personalityStatus: "source_stale",
    });
    expect(request.lane).toBe("full");
    if (request.lane !== "full") return;
    expect(request.personalityWarning).toBe("source_stale");
    expect(request.approvalPolicy).toBe("explicit");
  });

  it("allows a targetless intent but still refuses an incompatible declared target", () => {
    const targetless = { ...intent, target: { platform: "x" as const, targetId: null } };
    expect(resolveWritingRequest(targetless, { ...boundContext, targetCompatible: false }).lane).toBe(
      "full",
    );
    expect(resolveWritingRequest(intent, { ...boundContext, targetCompatible: false }).lane).toBe(
      "refused",
    );
  });

  it("never resolves a deliverable a send adapter could accept", () => {
    for (const surface of NURTURE_WRITING_SURFACES) {
      const platform = surface.split("/")[0] as "x" | "linkedin" | "facebook";
      const request = resolveWritingRequest(
        { ...intent, surface, target: { platform, targetId: "tgt_1" } },
        boundContext,
      );
      expect(request.lane).toBe("full");
      if (request.lane !== "full") continue;
      expect(request.capability.deliverable).toBe("draft_only");
      expect(request.capability.publish).toBe(getSurfaceCapabilities(surface).publish);
      // The mandate, not the capability table, is what makes it draft-only — so a consumer that
      // gains a publish-capable surface later still cannot send.
      expect(request.capability.publishBlockedBy).toBe("assist_only_mandate");
    }
  });

  it("persists the intent without a second binding claim", () => {
    const record = toWritingIntentRecord(intent);
    expect(record).not.toHaveProperty("bindingId");
    expect(record.intentId).toBe("wint_abcdef1");
    expect(readWritingIntentRecord(record)).toEqual(record);
    expect(readWritingIntentRecord({ ...record, bindingId: "pb_active" })).toBeNull();
    expect(isAssistOnlyIntent(record)).toBe(true);
    expect(isAssistOnlyIntent(null)).toBe(false);
    expect(isAssistOnlyIntent({ mandate: "assist_only" })).toBe(false);
  });

  it("keeps the consumer registry closed", () => {
    expect(WRITING_INTENT_CONSUMERS).toEqual(["contact_relationship_nurture"]);
    expect(
      writingIntentDraftSchema.safeParse({ ...draft, consumer: "profile_publish" }).success,
    ).toBe(false);
  });
});
