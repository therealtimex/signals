import { describe, expect, it } from "vitest";
import { mergeLaunchMetadata } from "@/lib/writing/launch-writing";
import { sha256 } from "@/lib/writing/hash";

const evidence = { by: "user" as const, at: 10, evidence: { kind: "api" as const, caller: "test" } };

function note(contextApproval?: unknown) {
  return {
    id: "src_source1",
    kind: "note",
    text: "Grounded source",
    enteredAt: 1,
    sensitivity: {
      level: "public",
      reason: "public_default",
      ...(contextApproval !== undefined ? { contextApproval } : {}),
    },
  };
}

describe("writing launch metadata", () => {
  it("accepts a schema-v1 partial run document", () => {
    const result = mergeLaunchMetadata({
      existingMetadata: {},
      incomingMetadata: {
        writing: {
          schemaVersion: 1,
          runs: [{ workflowRunId: "run-1", mode: "draft", startedAt: 1 }],
        },
      },
      launchId: "launch-1",
      scope: "shared",
    });

    expect(result.writing).toEqual({
      schemaVersion: 1,
      runs: [{ workflowRunId: "run-1", mode: "draft", startedAt: 1 }],
    });
  });

  it("strips malformed approvals, accepts complete evidence, and carries it by source id", () => {
    const stripped = mergeLaunchMetadata({
      existingMetadata: {},
      incomingMetadata: { writing: { schemaVersion: 1, sources: [note(true)] } },
      launchId: "launch-1",
      scope: "shared",
    });
    expect(stripped.writing?.sources?.[0]).toMatchObject({ sha256: sha256("Grounded source") });
    expect(stripped.writing?.sources?.[0].sensitivity).not.toHaveProperty("contextApproval");

    const approved = mergeLaunchMetadata({
      existingMetadata: stripped.metadata,
      incomingMetadata: { writing: { sources: [note(evidence)] } },
      launchId: "launch-1",
      scope: "shared",
    });
    expect(approved.writing?.sources?.[0].sensitivity).toMatchObject({ contextApproval: evidence });

    const carried = mergeLaunchMetadata({
      existingMetadata: approved.metadata,
      incomingMetadata: { writing: { sources: [note()] } },
      launchId: "launch-1",
      scope: "shared",
    });
    expect(carried.writing?.sources?.[0].sensitivity).toMatchObject({ contextApproval: evidence });
  });

  it("preserves the stored writing block when unrelated metadata changes", () => {
    const existing = {
      writing: { schemaVersion: 1, runs: [{ workflowRunId: "run-1", mode: "draft", startedAt: 1 }] },
      keep: true,
    };
    const result = mergeLaunchMetadata({
      existingMetadata: existing,
      incomingMetadata: { dashboard: { color: "pink" } },
      launchId: "launch-1",
      scope: "shared",
    });

    expect(result.metadata).toMatchObject({ ...existing, dashboard: { color: "pink" } });
  });
});
