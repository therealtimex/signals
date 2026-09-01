import { describe, expect, it } from "vitest";
import type { PersonalityBinding } from "@/lib/personality/contracts";
import type { PlatformTarget } from "@/lib/db/types";
import {
  personalityGateFailure,
  stampAuditPersonality,
  stampVariantPersonality,
  type PersonalityWritingGuard,
} from "@/lib/writing/personality-guard";
import { targetPersonalityDecisionSchema } from "@/lib/personality/target-representation";
import { personalitySourceStaleFinding } from "@/lib/writing/personality-lineage";

const hash = (character: string) => character.repeat(64);

const binding = {
  schemaVersion: 1,
  id: "pb_binding1",
  sourceHash: hash("b"),
  personalityHash: hash("a"),
  workspace: { slug: "signals", id: "workspace-id", key: "workspace-key", dir: "/workspace" },
  identity: { selfContactId: "self-1", representedOrgId: null },
} as PersonalityBinding;

function target(metadata: Record<string, unknown>): PlatformTarget {
  return {
    id: "target-x",
    status: "active",
    metadata: JSON.stringify(metadata),
    platform: "x",
  } as PlatformTarget;
}

const decision = targetPersonalityDecisionSchema.parse({
  schemaVersion: 1,
  represents: { kind: "self", contactId: "self-1" },
  setAt: 1,
  by: "user",
  evidence: { kind: "ui", route: "/settings/personality" },
  bindingIdAtDecision: binding.id,
});

function guard(overrides: Partial<PersonalityWritingGuard> = {}): PersonalityWritingGuard {
  const targetRow = target({ personality: decision });
  return {
    workspace: binding.workspace,
    binding,
    status: "bound",
    currentPersonalityHash: binding.personalityHash,
    currentSourceHash: binding.sourceHash,
    currentIdentity: binding.identity,
    compatibleTargets: new Set([targetRow.id]),
    targetDecisions: new Map([[targetRow.id, decision]]),
    targets: new Map([[targetRow.id, targetRow]]),
    detail: undefined,
    ...overrides,
  };
}

describe("Personality writing guard", () => {
  it("stamps the full server-owned binding and target snapshot", () => {
    expect(stampVariantPersonality({
      guard: guard(),
      bindingId: binding.id,
      targetId: "target-x",
      requireCompatibleTarget: true,
    })).toEqual({
      schemaVersion: 1,
      bindingId: binding.id,
      personalityHash: binding.personalityHash,
      bindingSourceHash: binding.sourceHash,
      workspaceSlug: "signals",
      workspaceId: "workspace-id",
      workspaceKey: "workspace-key",
      identity: binding.identity,
      target: { targetId: "target-x", represents: decision.represents },
    });
  });

  it("requires a compatible target for audited publish-capable surfaces", () => {
    expect(() => stampVariantPersonality({
      guard: guard(),
      bindingId: binding.id,
      requireCompatibleTarget: true,
    })).toThrow(expect.objectContaining({
      details: { reason: "target_identity_mismatch" },
    }));

    expect(stampVariantPersonality({
      guard: guard(),
      bindingId: binding.id,
      requireCompatibleTarget: false,
    }).target).toBeNull();
  });

  it("distinguishes the narrow source-stale audit from hard identity drift", () => {
    const sourceStaleGuard = guard({ status: "source_stale", currentSourceHash: hash("c") });
    const snapshot = stampVariantPersonality({
      guard: sourceStaleGuard,
      bindingId: binding.id,
    });
    expect(stampAuditPersonality(snapshot, sourceStaleGuard)).toMatchObject({
      statusAtAudit: "source_stale",
      currentSourceHash: hash("c"),
    });
    expect(() => stampVariantPersonality({
      guard: guard({ currentIdentity: { selfContactId: "self-2", representedOrgId: null } }),
      bindingId: binding.id,
    })).toThrow(/represented identity changed/);
  });

  it.each([
    ["binding", guard({ binding: { ...binding, id: "pb_binding2" } }), "personality_binding_stale"],
    ["files", guard({ status: "drifted", currentPersonalityHash: null }), "personality_drifted"],
    ["identity", guard({ currentIdentity: { selfContactId: "self-2", representedOrgId: null } }), "personality_identity_mismatch"],
  ])("fails closed on %s drift", (_label, current, reason) => {
    const baseline = guard();
    const snapshot = stampVariantPersonality({ guard: baseline, bindingId: binding.id });
    const audit = stampAuditPersonality(snapshot, baseline);
    expect(personalityGateFailure({ snapshot, audit, guard: current })).toMatchObject({ reason });
  });

  it("detects stale source audit snapshots even when Personality bytes are unchanged", () => {
    const baseline = guard();
    const snapshot = stampVariantPersonality({ guard: baseline, bindingId: binding.id });
    const audit = stampAuditPersonality(snapshot, baseline);
    expect(personalityGateFailure({
      snapshot,
      audit,
      guard: guard({ status: "source_stale", currentSourceHash: hash("c") }),
    })).toEqual({
      reason: "personality_source_stale",
      revokedReason: "personality_source_stale",
    });
  });

  it("accepts only the exact deterministic warning for a current source-stale audit", () => {
    const current = guard({ status: "source_stale", currentSourceHash: hash("c") });
    const snapshot = stampVariantPersonality({ guard: current, bindingId: binding.id });
    const audit = stampAuditPersonality(snapshot, current);
    const finding = personalitySourceStaleFinding({
      bindingSourceHash: snapshot.bindingSourceHash,
      currentSourceHash: audit.currentSourceHash,
    });
    expect(personalityGateFailure({
      snapshot,
      audit,
      auditFindings: [finding],
      guard: current,
    })).toBeNull();
    expect(personalityGateFailure({
      snapshot,
      audit,
      auditFindings: [{ ...finding, evidence: "forged" }],
      guard: current,
    })).toMatchObject({ reason: "personality_source_stale" });
  });
});
