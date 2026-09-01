import { describe, expect, it } from "vitest";
import {
  PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION,
  PERSONALITY_SOURCE_STALE_FINDING_CODE,
  auditPersonalityMatchesSnapshot,
  hasExactPersonalitySourceStaleFinding,
  isPersonalityAwareWritingSkillVersion,
  personalitySnapshotsEqual,
  personalitySourceStaleFinding,
  variantPersonalityInputSchema,
  variantPersonalitySnapshotSchema,
} from "@/lib/writing/personality-lineage";
import {
  variantWritingInputSchema,
  writingAuditInputSchema,
} from "@/lib/writing/contracts";

const hash = (character: string) => character.repeat(64);

const snapshot = variantPersonalitySnapshotSchema.parse({
  schemaVersion: 1,
  bindingId: "pb_binding1",
  personalityHash: hash("a"),
  bindingSourceHash: hash("b"),
  workspaceSlug: "signals",
  workspaceId: "workspace-id",
  workspaceKey: "workspace-key",
  identity: { selfContactId: "contact-self", representedOrgId: null },
  target: {
    targetId: "target-x",
    represents: { kind: "self", contactId: "contact-self" },
  },
});

describe("Personality writing lineage", () => {
  it("uses 1.1.0 as the first Personality-aware writing skill version", () => {
    expect(PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION).toBe("1.1.0");
    expect(isPersonalityAwareWritingSkillVersion("1.0.99")).toBe(false);
    expect(isPersonalityAwareWritingSkillVersion("1.1.0-beta.1")).toBe(false);
    expect(isPersonalityAwareWritingSkillVersion("1.1.0")).toBe(true);
    expect(isPersonalityAwareWritingSkillVersion("2.0.0")).toBe(true);
    expect(isPersonalityAwareWritingSkillVersion("not-semver")).toBe(false);
  });

  it("allows clients to select only a binding id", () => {
    expect(variantPersonalityInputSchema.parse({ bindingId: "pb_binding1" })).toEqual({
      bindingId: "pb_binding1",
    });
    for (const forged of [
      { personalityHash: hash("a") },
      { bindingSourceHash: hash("b") },
      { workspaceSlug: "forged" },
      { identity: snapshot.identity },
      { target: snapshot.target },
    ]) {
      expect(variantPersonalityInputSchema.safeParse({
        bindingId: "pb_binding1",
        ...forged,
      }).success).toBe(false);
    }
  });

  it("rejects a caller-supplied audit Personality snapshot", () => {
    expect(writingAuditInputSchema.safeParse({ personality: snapshot }).success).toBe(false);
    expect(variantWritingInputSchema.safeParse({
      personality: { bindingId: "pb_binding1", personalityHash: hash("a") },
    }).success).toBe(false);
  });

  it("compares complete immutable snapshots", () => {
    expect(personalitySnapshotsEqual(snapshot, structuredClone(snapshot))).toBe(true);
    expect(personalitySnapshotsEqual(snapshot, {
      ...snapshot,
      target: { targetId: "target-x", represents: { kind: "unbound" } },
    })).toBe(false);
    expect(personalitySnapshotsEqual(undefined, null)).toBe(true);
    expect(auditPersonalityMatchesSnapshot(snapshot, {
      ...snapshot,
      currentSourceHash: hash("c"),
      statusAtAudit: "source_stale",
    })).toBe(true);
    expect(auditPersonalityMatchesSnapshot(snapshot, {
      ...snapshot,
      workspaceKey: "other-workspace",
      currentSourceHash: hash("c"),
      statusAtAudit: "source_stale",
    })).toBe(false);
  });

  it("builds one deterministic source-stale warning", () => {
    const finding = personalitySourceStaleFinding({
      bindingSourceHash: hash("b"),
      currentSourceHash: hash("c"),
    });
    expect(finding).toEqual(personalitySourceStaleFinding({
      bindingSourceHash: hash("b"),
      currentSourceHash: hash("c"),
    }));
    expect(finding).toMatchObject({
      code: PERSONALITY_SOURCE_STALE_FINDING_CODE,
      severity: "warning",
      evidence: `bindingSourceHash=${hash("b")};currentSourceHash=${hash("c")}`,
    });
    expect(hasExactPersonalitySourceStaleFinding([finding], {
      bindingSourceHash: hash("b"),
      currentSourceHash: hash("c"),
    })).toBe(true);
    expect(hasExactPersonalitySourceStaleFinding([finding, finding], {
      bindingSourceHash: hash("b"),
      currentSourceHash: hash("c"),
    })).toBe(false);
    expect(hasExactPersonalitySourceStaleFinding([{ ...finding, message: "forged" }], {
      bindingSourceHash: hash("b"),
      currentSourceHash: hash("c"),
    })).toBe(false);
  });
});
