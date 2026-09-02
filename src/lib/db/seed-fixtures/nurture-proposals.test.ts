import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { variants } from "@/lib/db/schema";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { setTargetRepresentation } from "@/lib/personality/use-cases";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import { withPersonalityWritingGuard } from "@/lib/writing/personality-guard";
import { listWorkflowRunProposals } from "@/lib/writing/workflow-run-proposals";
import { resetCoreTables } from "@/test/db";
import {
  installPersonalityBinding,
  personalityWorkspace,
} from "@/test/personality-writing-fixture";
import { seedNurtureProposalFixture } from "@/lib/db/seed-fixtures/nurture-proposals";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import type { PersonalityCapabilityState } from "@/lib/rtx/capabilities";
import {
  rejectWritingProposal,
  requestWritingProposalRevision,
} from "@/lib/writing/variant-writing";

let storageDir = "";

const capability: PersonalityCapabilityState = {
  state: "available",
  version: 1,
  ref: {
    key: "workspace.personality.transactions",
    version: 1,
    schemaVersion: 1,
    fileHash: "sha256-hex",
  },
  maxFiles: 16,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
};

describe("nurture proposal experience fixture", () => {
  beforeEach(() => {
    resetCoreTables();
    resetPersonalityStore();
    storageDir = mkdtempSync(join(tmpdir(), "signals-nurture-proposals-"));
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("seeds three run-anchored pending proposals and materializes with UI evidence", async () => {
    const workspace = personalityWorkspace(storageDir);
    const authority = await installPersonalityBinding(workspace);
    const target = registerPlatformTarget({
      connectionId: ensureBrowserConnection({ sessionName: "experience-fixture" }).id,
      platform: "x",
      kind: "account",
      name: "Experience target",
      handle: "@experience",
      capabilities: ["publish"],
      source: "test",
    });
    await setTargetRepresentation({
      targetId: target.id,
      bindingId: authority.binding.id,
      represents: { kind: "self", contactId: authority.self.id },
      evidence: { kind: "ui", route: "/settings/personality" },
    }, authority.dependencies);
    createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
      config: JSON.stringify(buildContactNurtureTemplateConfig()),
      isSystem: 1,
    });
    const dependencies = {
      ...authority.dependencies,
      probeCapability: async () => capability,
    };
    const fixture = await seedNurtureProposalFixture({
      label: "test-issue-413",
      dependencies,
    });
    const result = listWorkflowRunProposals(fixture.workflowRunId);

    expect(result.launches).toHaveLength(1);
    expect(result.proposals.map((proposal) => proposal.variantId).sort()).toEqual(
      [...fixture.variantIds].sort(),
    );
    expect(result.summary).toMatchObject({ total: 3, pendingReview: 3 });
    expect(result.proposals.every((proposal) =>
      proposal.valid
      && proposal.capability.publish === "draft_only"
      && proposal.approval.policy === "explicit"
      && proposal.mandate === "assist_only"
      && Boolean(proposal.recipient?.name)
    )).toBe(true);

    await expect(seedNurtureProposalFixture({
      label: "test-issue-413",
      dependencies: {
        ...dependencies,
        listTargets: () => [],
      },
    })).rejects.toMatchObject({
      code: "fixture_precondition_unmet",
      reasons: ["register an active X acting target represented by that Personality"],
    });
    const preserved = listWorkflowRunProposals(fixture.workflowRunId);
    expect(preserved.proposals.map((proposal) => proposal.variantId).sort()).toEqual(
      [...fixture.variantIds].sort(),
    );
    expect(preserved.summary).toMatchObject({ total: 3, pendingReview: 3 });

    const materialized = await withPersonalityWritingGuard(
      (guard, tx) => materializeVariantWithRunner({
        variantId: fixture.variantIds[0],
        approval: {
          by: "user",
          evidence: { kind: "ui", route: `/dashboard/workflows/${fixture.workflowRunId}` },
        },
      }, guard, tx),
      authority.dependencies,
    );
    expect("gateError" in materialized).toBe(false);
    const after = listWorkflowRunProposals(fixture.workflowRunId);
    expect(after.summary).toMatchObject({ pendingReview: 2, materialized: 1 });
    const approved = after.proposals.find((proposal) => proposal.variantId === fixture.variantIds[0]);
    expect(approved?.valid && approved.approval).toMatchObject({
      state: "approved",
      by: "user",
      evidenceKind: "ui",
    });

    requestWritingProposalRevision(fixture.variantIds[1], {
      evidence: { kind: "ui", route: `/dashboard/workflows/${fixture.workflowRunId}` },
      note: "Make the reference more specific.",
    });
    rejectWritingProposal(fixture.variantIds[2], {
      evidence: { kind: "ui", route: `/dashboard/workflows/${fixture.workflowRunId}` },
      note: "Not a good moment for this contact.",
    });
    const decided = listWorkflowRunProposals(fixture.workflowRunId);
    expect(decided.summary).toMatchObject({
      pendingReview: 1,
      materialized: 1,
      rejected: 1,
    });
    const revision = decided.proposals.find((proposal) => proposal.variantId === fixture.variantIds[1]);
    expect(revision?.valid && revision.revisionRequest).toMatchObject({
      note: "Make the reference more specific.",
      evidenceKind: "ui",
    });
    const rejected = decided.proposals.find((proposal) => proposal.variantId === fixture.variantIds[2]);
    expect(rejected?.valid && rejected.approval).toMatchObject({
      state: "rejected",
      by: "user",
      note: "Not a good moment for this contact.",
    });

    const corrupt = db.select().from(variants).all().find((row) => row.id === fixture.variantIds[1])!;
    const metadata = JSON.parse(corrupt.metadata ?? "{}");
    delete metadata.writing.platform;
    db.update(variants).set({ metadata: JSON.stringify(metadata) })
      .where(eq(variants.id, corrupt.id)).run();
    const invalid = listWorkflowRunProposals(fixture.workflowRunId).proposals.find(
      (proposal) => proposal.variantId === fixture.variantIds[1],
    );
    expect(invalid).toMatchObject({ valid: false });
  });
});
