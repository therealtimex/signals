import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type PersonalityProposal,
  personalityProposalSchema,
} from "@/lib/personality/contracts";
import {
  computeProposalHash,
  readPersonalityStore,
  withPersonalityStore,
} from "@/lib/personality/store";
import {
  personalityStoreDir,
  resetPersonalityStore,
} from "@/lib/personality/store-paths";

const workspace = {
  slug: "signals",
  id: "42",
  dir: "/safe/working-data/signals",
  key: "0123456789abcdef0123456789abcdef",
};

function proposal(): PersonalityProposal {
  const provisional = {
    schemaVersion: 1 as const,
    id: "prp_store01",
    kind: "unbind" as const,
    proposedBindingId: "pb_store001",
    workspace,
    identity: { selfContactId: "self-1", representedOrgId: null },
    basedOnBindingId: null,
    sourceSnapshot: null,
    sourceHash: "",
    files: [
      ["IDENTITY.md", "identity"],
      ["SOUL.md", "boundaries"],
      ["VOICE.md", "voice"],
      ["BRAND.md", "brand"],
    ].map(([path, section]) => ({
      path,
      section,
      exists: false,
      bindingFileHash: null,
      currentFileHash: null,
      currentBlockHash: null,
      proposedBlock: null,
      proposedBlockHash: null,
      proposedFile: null,
      proposedFileHash: null,
      unmanagedBytes: 0,
      driftDiff: null,
      diff: "",
    })),
    shim: { createClaudeSymlink: false },
    preflight: { warnings: [] },
    intentHash: "a".repeat(64),
    proposalHash: "0".repeat(64),
    noop: true,
    proposedBy: { kind: "ui" as const, at: 1_700_000_000 },
  };
  return personalityProposalSchema.parse({
    ...provisional,
    proposalHash: computeProposalHash(provisional as PersonalityProposal),
  });
}

beforeEach(() => resetPersonalityStore());

describe.sequential("Personality store", () => {
  it("installs immutable proposals before one generation-checked index replace", async () => {
    const document = proposal();
    await withPersonalityStore((session) => {
      session.commit({
        schemaVersion: 1,
        bindings: {},
        proposals: {
          [document.id]: {
            state: "proposed",
            workspaceKey: workspace.key,
            updatedAt: 1_700_000_000,
            approval: null,
            rejection: null,
            attempt: null,
            attemptHistory: [],
            failure: null,
            hostResult: null,
          },
        },
      }, [document]);
    });
    const store = readPersonalityStore();
    expect(store.index.generation).toBe(1);
    expect(store.proposals.get(document.id)).toEqual(document);
  });

  it("reports unreferenced immutable files without adopting them", () => {
    const root = personalityStoreDir();
    mkdirSync(join(root, "proposals"), { recursive: true });
    writeFileSync(join(root, "proposals", "prp_orphan01.json"), "{}\n");
    expect(readPersonalityStore().orphanProposalIds).toEqual(["prp_orphan01"]);
    expect(readPersonalityStore().index.proposals).toEqual({});
  });

  it("fails closed when an index references a missing immutable proposal", async () => {
    const document = proposal();
    await withPersonalityStore((session) => {
      session.commit({
        schemaVersion: 1,
        bindings: {},
        proposals: {
          [document.id]: {
            state: "proposed",
            workspaceKey: workspace.key,
            updatedAt: 1,
            approval: null,
            rejection: null,
            attempt: null,
            attemptHistory: [],
            failure: null,
            hostResult: null,
          },
        },
      }, [document]);
    });
    unlinkSync(join(personalityStoreDir(), "proposals", `${document.id}.json`));
    expect(() => readPersonalityStore()).toThrowError(expect.objectContaining({
      code: "STORE_CONFLICT",
      details: expect.objectContaining({ reason: "store_corrupt" }),
    }));
  });

  it("fails closed when immutable content no longer matches its proposal hash", async () => {
    const document = proposal();
    await withPersonalityStore((session) => {
      session.commit({
        schemaVersion: 1,
        bindings: {},
        proposals: {
          [document.id]: {
            state: "proposed",
            workspaceKey: workspace.key,
            updatedAt: 1,
            approval: null,
            rejection: null,
            attempt: null,
            attemptHistory: [],
            failure: null,
            hostResult: null,
          },
        },
      }, [document]);
    });
    writeFileSync(
      join(personalityStoreDir(), "proposals", `${document.id}.json`),
      `${JSON.stringify({ ...document, noop: false })}\n`,
    );
    expect(() => readPersonalityStore()).toThrowError(expect.objectContaining({
      code: "STORE_CONFLICT",
    }));
  });
});
