import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { launches, variants } from "@/lib/db/schema";
import {
  findWorkflowRunIdForProposal,
  listWorkflowRunProposals,
} from "@/lib/writing/workflow-run-proposals";
import { resetCoreTables } from "@/test/db";

function composition(workflowRunId: string) {
  return {
    schemaVersion: 1,
    workflowRunId,
    templateId: null,
    consumer: "contact_relationship_nurture",
    mandate: "assist_only",
    surfaces: ["x/reply"],
    stampedAt: 10,
  };
}

function insertLaunch(id: string, metadata: Record<string, unknown>) {
  db.insert(launches).values({
    id,
    name: id,
    metadata: JSON.stringify(metadata),
  }).run();
}

function insertInvalidWritingVariant(id: string, launchId: string, workflowRunId: string) {
  db.insert(variants).values({
    id,
    launchId,
    body: id,
    generationMetadata: JSON.stringify({
      schemaVersion: 1,
      kind: "signals-writing",
      mode: "draft",
      model: null,
      skill: { name: "signals-writing", version: "1.1.0" },
      agent: { workflowRunId },
      requestHash: `request-${id}`,
      generatedAt: 10,
    }),
    metadata: JSON.stringify({ writing: {} }),
  }).run();
}

describe("workflow-run proposal discovery", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("discovers only server-composed launches and keeps invalid proposals visible", () => {
    insertLaunch("launch_anchored", {
      writing: { composition: composition("run_target") },
    });
    insertLaunch("launch_other", {
      writing: { composition: composition("run_other") },
    });
    insertLaunch("launch_untrusted", {
      writing: { runs: [{ workflowRunId: "run_target", mode: "draft", startedAt: 10 }] },
    });
    insertInvalidWritingVariant("variant_anchored", "launch_anchored", "run_target");
    insertInvalidWritingVariant("variant_other", "launch_other", "run_other");
    insertInvalidWritingVariant("variant_untrusted", "launch_untrusted", "run_target");

    const result = listWorkflowRunProposals("run_target");

    expect(result.launches.map((launch) => launch.id)).toEqual(["launch_anchored"]);
    expect(result.proposals).toEqual([
      expect.objectContaining({
        valid: false,
        variantId: "variant_anchored",
        launchId: "launch_anchored",
        body: "variant_anchored",
      }),
    ]);
    expect(result.summary).toMatchObject({ total: 1, blocked: 1, pendingReview: 0 });
    expect(findWorkflowRunIdForProposal("variant_anchored")).toBe("run_target");
    expect(findWorkflowRunIdForProposal("variant_untrusted")).toBeNull();
  });
});
