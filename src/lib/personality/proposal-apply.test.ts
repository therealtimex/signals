import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import { db } from "@/lib/db/client";
import { contentItems, launches, variants } from "@/lib/db/schema";
import {
  approvePersonalityProposal,
  retryPersonalityProposal,
  type PersonalityApplyDependencies,
} from "@/lib/personality/apply";
import {
  brandRenderedBrandInput,
  brandRenderedIdentityInput,
  brandRenderedVoiceInput,
  type PersonalityBinding,
  type PersonalityProposal,
} from "@/lib/personality/contracts";
import {
  HostPersonalityError,
  type HostPersonalityListing,
  type HostPersonalityTransaction,
  type PersonalityHostClient,
} from "@/lib/personality/host-client";
import {
  proposePersonalityProjection,
  proposePersonalityRollback,
  proposePersonalityUnbind,
  rejectPersonalityProposal,
  type PersonalityProposalDependencies,
} from "@/lib/personality/proposal";
import { resetPersonalityStore } from "@/lib/personality/store-paths";
import { readPersonalityStore, withPersonalityStore } from "@/lib/personality/store";
import { getPersonalityBindingView } from "@/lib/personality/status";
import {
  approvePersonalityProjection,
  retryPersonalityProjection,
} from "@/lib/personality/use-cases";
import { readPersonalityWorkspaceFiles } from "@/lib/personality/workspace";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import type { PersonalityCapabilityState } from "@/lib/rtx/capabilities";
import { resetCoreTables } from "@/test/db";
import { buildWritingUnits } from "@/lib/writing/content-writing";

const root = mkdtempSync(join(tmpdir(), "signals-378-proposal-"));
const workspaceDir = join(root, "workspace");
const workspace: PersonalityWorkspace = {
  slug: "signals",
  id: "42",
  dir: workspaceDir,
  key: "0123456789abcdef0123456789abcdef",
};

const available: PersonalityCapabilityState = {
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

function sources(name = "Ada", contactId = "contact-self", orgId: string | null = null) {
  return {
    sources: {
      identity: brandRenderedIdentityInput({
        contactId,
        name,
        preferredName: null,
        headline: "Builder",
        bio: null,
        currentRole: null,
        website: null,
        profiles: [],
        representedOrgName: orgId ? "Example Org" : null,
      }),
      brand: orgId ? brandRenderedBrandInput({
        orgId,
        name: "Example Org",
        description: null,
        website: null,
        industry: null,
        companySize: null,
        primaryDomain: null,
        profiles: [],
        selfRelationshipTitle: null,
      }) : null,
      voice: null,
      statements: null,
    },
    revisions: { self: 1, ...(orgId ? { org: 1 } : {}) },
  };
}

function voiceSources(
  profileId: `vp_${string}`,
  label: string,
  hashCharacter: string,
) {
  const bundle = sources();
  return {
    ...bundle,
    sources: {
      ...bundle.sources,
      voice: brandRenderedVoiceInput({
        profile: {
          id: profileId,
          label,
          version: 1,
          hash: hashCharacter.repeat(64),
        },
        platforms: ["x"],
        sentenceLength: null,
        openers: [],
        closers: [],
        punctuation: [],
        formats: [],
        emoji: [],
        hashtags: [],
        vocabulary: { keep: [], avoid: [] },
        protectedQuirks: [],
        taboo: [],
        signatureLines: [],
        exemplars: [],
      }),
    },
  };
}

function idFactory() {
  let value = 0;
  return (prefix: "prp" | "pb") => `${prefix}_fixture${++value}`;
}

function proposalDependencies(
  load: NonNullable<PersonalityProposalDependencies["loadSources"]> = () => sources(),
  newId = idFactory(),
): PersonalityProposalDependencies {
  return {
    now: () => 1_700_000_000_000,
    newId,
    resolveWorkspace: async () => workspace,
    readWorkspaceFiles: readPersonalityWorkspaceFiles,
    loadSources: load,
  };
}

function listing(proposal: PersonalityProposal) {
  return {
    success: true as const,
    workspace: { ...workspace },
    files: proposal.files.flatMap((file) => file.currentFileHash === null
      ? []
      : [{
          path: file.path,
          fileHash: file.currentFileHash,
          size: Buffer.byteLength(file.proposedFile ?? "", "utf8"),
          content: file.proposedFile,
        }]),
    claudeShim: "missing" as const,
    allowlist: {
      pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}\\.md$",
      excluded: ["HEARTBEAT.md", "MEMORY.md", "CLAUDE.md"],
    },
  };
}

const listingMismatches: Array<[
  string,
  (value: HostPersonalityListing) => HostPersonalityListing,
]> = [
  ["workspace slug", (value) => ({
    ...value,
    workspace: { ...value.workspace, slug: "other" },
  })],
  ["workspace id", (value) => ({
    ...value,
    workspace: { ...value.workspace, id: "99" },
  })],
  ["workspace directory", (value) => ({
    ...value,
    workspace: { ...value.workspace, dir: `${workspace.dir}-moved` },
  })],
  ...(["IDENTITY.md", "SOUL.md", "VOICE.md", "BRAND.md", "AGENTS.md"] as const).map(
    (path): [string, (value: HostPersonalityListing) => HostPersonalityListing] => [
      `${path} hash`,
      (value) => ({
        ...value,
        files: [
          ...value.files.filter((file) => file.path !== path),
          { path, fileHash: "c".repeat(64), size: 1, content: "x" },
        ],
      }),
    ],
  ),
];

function transaction(
  proposal: PersonalityProposal,
  transactionId: string,
  status: HostPersonalityTransaction["status"] = "committed",
): HostPersonalityTransaction {
  return {
    transactionId,
    status,
    origin: "sdk",
    appId: "signals-app",
    workspace: { ...workspace },
    requestHash: "b".repeat(64),
    files: proposal.files.map((file) => ({
      path: file.path,
      fileHash: status === "committed" ? file.proposedFileHash : file.currentFileHash,
    })),
    shim: {
      requested: proposal.shim.createClaudeSymlink,
      created: proposal.shim.createClaudeSymlink,
      state: proposal.shim.createClaudeSymlink ? "symlink" : "missing",
    },
    ...(status === "committed" ? {} : { reason: "fixture_failure" }),
    startedAt: "2026-08-30T00:00:00.000Z",
    finishedAt: "2026-08-30T00:00:01.000Z",
    replayed: false,
  };
}

function fakeHost(proposal: PersonalityProposal, options: {
  list?: () => Promise<HostPersonalityListing>;
  put?: (transactionId: string) => Promise<HostPersonalityTransaction>;
  inspect?: (transactionId: string) => Promise<HostPersonalityTransaction>;
  recover?: (transactionId: string) => Promise<HostPersonalityTransaction>;
} = {}): PersonalityHostClient {
  return {
    listPersonalityFiles: async () => options.list?.() ?? listing(proposal),
    putTransaction: async (_workspace: PersonalityWorkspace, transactionId: string) =>
      options.put?.(transactionId) ?? transaction(proposal, transactionId),
    inspectTransaction: async (_workspace: PersonalityWorkspace, transactionId: string) =>
      options.inspect?.(transactionId) ?? transaction(proposal, transactionId, "not_started"),
    recoverTransaction: async (_workspace: PersonalityWorkspace, transactionId: string) =>
      options.recover?.(transactionId) ?? transaction(proposal, transactionId, "restored_failure"),
  } as unknown as PersonalityHostClient;
}

function applyDependencies(
  proposal: PersonalityProposal,
  host = fakeHost(proposal),
  capability: PersonalityCapabilityState = available,
): PersonalityApplyDependencies {
  return {
    now: () => 1_700_000_001_000,
    resolveWorkspace: async () => workspace,
    readWorkspaceFiles: readPersonalityWorkspaceFiles,
    loadSources: () => sources(),
    probeCapability: async () => capability,
    hostClient: host,
    delay: async () => {},
  };
}

function materialize(proposal: PersonalityProposal): void {
  for (const file of proposal.files) {
    const path = join(workspace.dir, file.path);
    if (file.proposedFile === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      writeFileSync(path, file.proposedFile);
    }
  }
  if (proposal.shim.createClaudeSymlink && !existsSync(join(workspace.dir, "CLAUDE.md"))) {
    symlinkSync("AGENTS.md", join(workspace.dir, "CLAUDE.md"));
  }
}

function createBoundArtifact(binding: PersonalityBinding) {
  const launchId = "launch-facade-replay";
  const itemId = "item-facade-replay";
  const variantId = "variant-facade-replay";
  const now = 1_700_000_010;
  const personality = {
    schemaVersion: 1 as const,
    bindingId: binding.id,
    personalityHash: binding.personalityHash,
    bindingSourceHash: binding.sourceHash,
    workspaceSlug: binding.workspace.slug,
    workspaceId: binding.workspace.id,
    workspaceKey: binding.workspace.key,
    identity: binding.identity,
    target: null,
  };
  const writing = {
    schemaVersion: 1,
    platform: "x",
    surface: "x/post",
    goal: "likes",
    formulaId: "x/post/test@1",
    overlay: { id: "overlay:x", version: 1 },
    core: { version: 1 },
    voiceProfile: null,
    voicePrecedence: "voice_first",
    spine: { id: "spn_facade1", hash: "spine-hash" },
    units: buildWritingUnits(["Current binding stays authoritative."]),
    claimMap: [],
    audit: null,
    approval: {
      schemaVersion: 1,
      state: "approved",
      riskTier: "low",
      policy: "explicit",
      by: "user",
      at: now,
    },
    lineage: { sourceIds: [] },
    capability: { publish: "direct" },
    personality,
  };
  db.insert(launches).values({ id: launchId, name: "Facade replay fixture" }).run();
  db.insert(contentItems).values({
    id: itemId,
    body: writing.units.texts[0],
    contentType: "post",
    platformTarget: "x",
    status: "approved",
    aiGenerated: true,
    origin: "authored",
    direction: "outbound",
    platformData: JSON.stringify({ writing: { ...writing, variantId } }),
    createdAt: now,
    updatedAt: now,
  }).run();
  db.insert(variants).values({
    id: variantId,
    launchId,
    body: writing.units.texts[0],
    contentItemId: itemId,
    status: "selected",
    generationMetadata: "{}",
    metadata: JSON.stringify({ writing }),
    createdAt: now,
    updatedAt: now,
  }).run();
  return { variantId, itemId };
}

function artifactRows(ids: ReturnType<typeof createBoundArtifact>) {
  return {
    variant: db.select().from(variants).where(eq(variants.id, ids.variantId)).get(),
    item: db.select().from(contentItems).where(eq(contentItems.id, ids.itemId)).get(),
  };
}

beforeEach(() => {
  resetCoreTables();
  resetPersonalityStore();
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.sequential("Personality proposal and apply lifecycle", () => {
  it("persists an idempotent all-file proposal, gates apply, and commits one binding", async () => {
    const dependencies = proposalDependencies();
    const proposal = await proposePersonalityProjection({}, dependencies);
    expect(proposal.files.map((file) => file.path)).toEqual([
      "IDENTITY.md",
      "SOUL.md",
      "VOICE.md",
      "BRAND.md",
      "AGENTS.md",
    ]);
    expect(proposal.files.filter((file) => file.proposedBlock !== null)).toHaveLength(3);
    for (const file of proposal.files.filter((candidate) => candidate.proposedBlock !== null)) {
      expect(file.proposedFile).toContain(`binding=${proposal.proposedBindingId}`);
    }
    await expect(proposePersonalityProjection({}, dependencies)).resolves.toMatchObject({
      id: proposal.id,
      proposedBindingId: proposal.proposedBindingId,
    });

    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, fakeHost(proposal), {
      ...available,
      state: "not_granted",
    }))).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "approved",
      attempt: null,
    });

    const applied = await retryPersonalityProposal(proposal.id, applyDependencies(proposal));
    expect(applied.record).toMatchObject({ state: "applied", attempt: { attemptNo: 1 } });
    expect(applied.binding).toMatchObject({
      id: proposal.proposedBindingId,
      proposalId: proposal.id,
      attemptNo: 1,
      hostCapability: { version: 1 },
    });
    expect(applied.binding?.files).toHaveLength(5);
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal))).resolves.toMatchObject({
      binding: { id: proposal.proposedBindingId },
    });
  });

  it("creates true noops, supersedes distinct intents, and avoids a redundant dynamic pointer", async () => {
    const ids = idFactory();
    const loadAda = () => sources("Ada");
    const first = await proposePersonalityProjection({}, proposalDependencies(loadAda, ids));
    await approvePersonalityProposal({
      proposalId: first.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(first));
    materialize(first);
    const noop = await proposePersonalityProjection({}, proposalDependencies(loadAda, ids));
    expect(noop).toMatchObject({ noop: true, proposedBindingId: first.proposedBindingId });
    expect(noop.files.every((file) => file.diff === "")).toBe(true);
    await expect(approvePersonalityProposal({
      proposalId: noop.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(noop))).rejects.toMatchObject({ code: "CONFLICT" });

    const changed = await proposePersonalityProjection({}, proposalDependencies(
      () => sources("Ada Changed"),
      ids,
    ));
    expect(changed.noop).toBe(false);
    expect(readPersonalityStore().index.proposals[noop.id].state).toBe("superseded");

    resetPersonalityStore();
    rmSync(workspaceDir, { recursive: true, force: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspace.dir, "AGENTS.md"),
      "Read IDENTITY.md and SOUL.md for this workspace.\n",
    );
    const staticPointer = await proposePersonalityProjection({}, proposalDependencies(loadAda, ids));
    expect(staticPointer.files).toHaveLength(4);
    expect(staticPointer.shim.createClaudeSymlink).toBe(true);
  });

  it("revalidates and reports a pinned non-default voice profile by immutable ID", async () => {
    const defaultVoiceId = "vp_default01" as const;
    const pinnedVoiceId = "vp_pinned001" as const;
    const loadSources = (options: { voiceProfileId?: string } = {}) =>
      options.voiceProfileId === pinnedVoiceId
        ? voiceSources(pinnedVoiceId, "Pinned", "b")
        : voiceSources(defaultVoiceId, "Default", "a");
    const proposal = await proposePersonalityProjection(
      { voiceProfileId: pinnedVoiceId },
      proposalDependencies(loadSources),
    );
    expect(proposal.sourceSnapshot?.voice?.id).toBe(pinnedVoiceId);

    const applied = await approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposal),
      loadSources,
    });
    expect(applied.binding?.sourceHash).toBe(proposal.sourceHash);
    materialize(proposal);

    const view = await getPersonalityBindingView({
      resolveWorkspace: async () => workspace,
      readWorkspaceFiles: readPersonalityWorkspaceFiles,
      loadSources,
      probeCapability: async () => available,
    });
    expect(view.status).toMatchObject({
      status: "bound",
      currentSourceHash: proposal.sourceHash,
    });
  });

  it("stales a pinned projection when its voice is superseded before approval", async () => {
    const defaultVoiceId = "vp_default01" as const;
    const pinnedVoiceId = "vp_pinned001" as const;
    let pinnedApproved = true;
    const loadSources = (options: { voiceProfileId?: string } = {}) => {
      if (options.voiceProfileId !== pinnedVoiceId) {
        return voiceSources(defaultVoiceId, "Default", "a");
      }
      if (!pinnedApproved) {
        throw new AgentToolError("VALIDATION_ERROR", "Voice profile is not self-owned and approved", {
          reason: "voice_not_self_owned",
        });
      }
      return voiceSources(pinnedVoiceId, "Pinned", "b");
    };
    const proposal = await proposePersonalityProjection(
      { voiceProfileId: pinnedVoiceId },
      proposalDependencies(loadSources),
    );
    let puts = 0;
    pinnedApproved = false;

    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposal, fakeHost(proposal, {
        put: async (id) => {
          puts += 1;
          return transaction(proposal, id);
        },
      })),
      loadSources,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "source_changed" },
    });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[proposal.id].state).toBe("stale");
  });

  it("preserves identity mismatch precedence when a pinned voice belongs to the prior self", async () => {
    const pinnedVoiceId = "vp_pinned001" as const;
    let selfChanged = false;
    const loadSources = (options: { voiceProfileId?: string } = {}) => {
      if (!selfChanged) return voiceSources(pinnedVoiceId, "Pinned", "b");
      if (options.voiceProfileId === pinnedVoiceId) {
        throw new AgentToolError("VALIDATION_ERROR", "Voice profile is not self-owned and approved", {
          reason: "voice_not_self_owned",
        });
      }
      return sources("Grace", "contact-other");
    };
    const proposal = await proposePersonalityProjection(
      { voiceProfileId: pinnedVoiceId },
      proposalDependencies(loadSources),
    );
    let puts = 0;
    selfChanged = true;

    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposal, fakeHost(proposal, {
        put: async (id) => {
          puts += 1;
          return transaction(proposal, id);
        },
      })),
      loadSources,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "identity_mismatch" },
    });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[proposal.id].state).toBe("stale");
  });

  it("warns without replacing a regular CLAUDE.md", async () => {
    writeFileSync(join(workspace.dir, "CLAUDE.md"), "User-owned Claude instructions");
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    expect(proposal.preflight.warnings).toContain("claude_md_not_symlink");
    expect(proposal.shim.createClaudeSymlink).toBe(false);
  });

  it("preserves prose through unbind and rollback and audits the removed binding", async () => {
    const ids = idFactory();
    const projection = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    await approvePersonalityProposal({
      proposalId: projection.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(projection));
    materialize(projection);
    writeFileSync(join(workspace.dir, "IDENTITY.md"), `${projection.files[0].proposedFile}\n\nUser note`);

    const unbind = await proposePersonalityUnbind(
      { kind: "ui" },
      proposalDependencies(() => sources(), ids),
    );
    expect(unbind.files.find((file) => file.path === "IDENTITY.md")?.proposedFile).toBe("\n\nUser note");
    await approvePersonalityProposal({
      proposalId: unbind.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(unbind));
    materialize(unbind);
    const afterUnbind = readPersonalityStore().index.bindings[workspace.key];
    expect(afterUnbind.active).toBeNull();
    expect(afterUnbind.history.slice(0, 2).map((binding) => binding.kind)).toEqual([
      "unbind",
      "projection",
    ]);

    const rollback = await proposePersonalityRollback(
      projection.proposedBindingId,
      { kind: "ui" },
      proposalDependencies(() => sources(), ids),
    );
    expect(rollback.files.find((file) => file.path === "IDENTITY.md")?.proposedFile).toContain("User note");
    expect(rollback.files.find((file) => file.path === "IDENTITY.md")?.proposedFile).toContain(
      `binding=${rollback.proposedBindingId}`,
    );
    const restored = await approvePersonalityProposal({
      proposalId: rollback.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(rollback));
    expect(restored.binding).toMatchObject({ kind: "rollback", previousBindingId: null });
  });

  it("restores historical voice bytes after supersession and immediately reports source stale", async () => {
    const ids = idFactory();
    const voiceAId = "vp_voice_a01" as const;
    const voiceBId = "vp_voice_b01" as const;
    let voiceAApproved = true;
    const loadSources = (options: { voiceProfileId?: string } = {}) => {
      if (options.voiceProfileId === voiceAId) {
        if (!voiceAApproved) {
          throw new AgentToolError("VALIDATION_ERROR", "Voice profile is not self-owned and approved", {
            reason: "voice_not_self_owned",
          });
        }
        return voiceSources(voiceAId, "Voice A", "a");
      }
      return voiceSources(voiceBId, "Voice B", "b");
    };
    const projection = await proposePersonalityProjection(
      { voiceProfileId: voiceAId },
      proposalDependencies(loadSources, ids),
    );
    await approvePersonalityProposal({
      proposalId: projection.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, { ...applyDependencies(projection), loadSources });
    materialize(projection);

    const unbind = await proposePersonalityUnbind(
      { kind: "ui" },
      proposalDependencies(loadSources, ids),
    );
    await approvePersonalityProposal({
      proposalId: unbind.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(unbind));
    materialize(unbind);
    voiceAApproved = false;

    const rollback = await proposePersonalityRollback(
      projection.proposedBindingId,
      { kind: "ui" },
      proposalDependencies(loadSources, ids),
    );
    const restored = await approvePersonalityProposal({
      proposalId: rollback.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, { ...applyDependencies(rollback), loadSources });
    expect(restored.binding).toMatchObject({
      kind: "rollback",
      sourceHash: projection.sourceHash,
    });
    materialize(rollback);

    const view = await getPersonalityBindingView({
      resolveWorkspace: async () => workspace,
      readWorkspaceFiles: readPersonalityWorkspaceFiles,
      loadSources,
      probeCapability: async () => available,
    });
    expect(view.status).toMatchObject({
      status: "source_stale",
      detail: { sourceStale: { voice: true } },
    });
  });

  it("replays the binding produced by an applied proposal after newer lifecycle changes", async () => {
    const ids = idFactory();
    const first = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    await approvePersonalityProposal({
      proposalId: first.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(first));
    materialize(first);

    const changedSources = () => sources("Ada Changed");
    const second = await proposePersonalityProjection({}, proposalDependencies(changedSources, ids));
    await approvePersonalityProposal({
      proposalId: second.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, { ...applyDependencies(second), loadSources: changedSources });
    materialize(second);

    await expect(approvePersonalityProposal({
      proposalId: first.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    })).resolves.toMatchObject({ binding: { id: first.proposedBindingId } });
    await expect(retryPersonalityProposal(first.id)).resolves.toMatchObject({
      binding: { id: first.proposedBindingId },
    });

    const unbind = await proposePersonalityUnbind(
      { kind: "ui" },
      proposalDependencies(changedSources, ids),
    );
    await approvePersonalityProposal({
      proposalId: unbind.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(unbind));
    materialize(unbind);
    const rebound = await proposePersonalityProjection({}, proposalDependencies(changedSources, ids));
    await approvePersonalityProposal({
      proposalId: rebound.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, { ...applyDependencies(rebound), loadSources: changedSources });

    await expect(retryPersonalityProposal(unbind.id)).resolves.toMatchObject({ binding: null });
  });

  it("archives a restored failure before allocating a fresh explicit retry attempt", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    const failedHost = fakeHost(proposal, {
      put: async (transactionId) => {
        const restored = transaction(proposal, transactionId, "restored_failure");
        throw new HostPersonalityError(
          "restored",
          "TRANSACTION_RESTORED_FAILURE",
          500,
          {},
          restored,
        );
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, failedHost))).rejects.toMatchObject({
      code: "EXECUTION_ERROR",
    });
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "apply_failed",
      attempt: { attemptNo: 1, phase: "terminal" },
      hostResult: { status: "restored_failure" },
    });
    const retried = await retryPersonalityProposal(proposal.id, applyDependencies(proposal));
    expect(retried.record).toMatchObject({
      state: "applied",
      attempt: { attemptNo: 2 },
      attemptHistory: [{ attemptNo: 1, terminalStatus: "restored_failure" }],
    });
  });

  it("marks FILE_CHANGED stale and never creates a binding", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    let puts = 0;
    const host = fakeHost(proposal, {
      put: async () => {
        puts += 1;
        throw new HostPersonalityError("changed", "FILE_CHANGED", 409, {
          files: [{ path: "IDENTITY.md", currentFileHash: "c".repeat(64) }],
        });
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, host))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(puts).toBe(1);
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "stale",
      attempt: null,
    });
    expect(readPersonalityStore().index.bindings[workspace.key]).toBeUndefined();
  });

  it.each(listingMismatches)("refuses a mismatched host listing (%s) before PUT", async (_label, mutate) => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    let puts = 0;
    const host = fakeHost(proposal, {
      list: async () => mutate(listing(proposal)),
      put: async (id) => {
        puts += 1;
        return transaction(proposal, id);
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, host))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "stale",
      attempt: null,
    });
  });

  it("returns to approved when writer permission is revoked between probe and PUT", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    const host = fakeHost(proposal, {
      put: async () => {
        throw new HostPersonalityError(
          "permission required",
          "PERMISSION_REQUIRED",
          403,
        );
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, host))).rejects.toMatchObject({
      code: "CAPABILITY_UNSUPPORTED",
    });
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "approved",
      attempt: null,
      approval: { by: "user" },
    });
  });

  it("keeps an unknown submitted attempt when permission blocks transaction inspection", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, fakeHost(proposal, {
      put: async () => {
        throw new HostPersonalityError("connection lost", "NETWORK_ERROR", null);
      },
    })))).rejects.toMatchObject({ code: "EXECUTION_ERROR" });

    await expect(retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal, fakeHost(proposal, {
        inspect: async () => {
          throw new HostPersonalityError("permission required", "PERMISSION_REQUIRED", 403);
        },
      })),
    )).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "applying",
      attempt: { attemptNo: 1, phase: "submitted" },
    });
  });

  it("resumes a host commit after a lost response without a second PUT", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    let puts = 0;
    const unknownHost = fakeHost(proposal, {
      put: async () => {
        puts += 1;
        throw new HostPersonalityError("connection lost", "NETWORK_ERROR", null);
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, unknownHost))).rejects.toMatchObject({
      code: "EXECUTION_ERROR",
      details: { reason: "host_outcome_unknown" },
    });
    const pending = readPersonalityStore().index.proposals[proposal.id];
    expect(pending).toMatchObject({ state: "applying", attempt: { phase: "submitted" } });
    const replayHost = fakeHost(proposal, {
      inspect: async (id) => ({ ...transaction(proposal, id), replayed: true }),
      put: async () => {
        puts += 1;
        throw new Error("must not submit twice");
      },
    });
    const replayed = await retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal, replayHost),
    );
    expect(puts).toBe(1);
    expect(replayed.record).toMatchObject({
      state: "applied",
      hostResult: { status: "committed", replayed: true },
      attempt: { attemptNo: 1 },
    });
  });

  it("restores recovery-required attempt first and allocates N+1 only on a later retry", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    const recoveryHost = fakeHost(proposal, {
      put: async (id) => {
        const receipt = transaction(proposal, id, "recovery_required");
        throw new HostPersonalityError(
          "recovery required",
          "TRANSACTION_RECOVERY_REQUIRED",
          500,
          {},
          receipt,
        );
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, recoveryHost))).rejects.toMatchObject({ code: "EXECUTION_ERROR" });

    let recoveries = 0;
    const restoreHost = fakeHost(proposal, {
      inspect: async (id) => transaction(proposal, id, "recovery_required"),
      recover: async (id) => {
        recoveries += 1;
        const receipt = transaction(proposal, id, "restored_failure");
        throw new HostPersonalityError(
          "restored",
          "TRANSACTION_RESTORED_FAILURE",
          500,
          {},
          receipt,
        );
      },
    });
    const restored = await retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal, restoreHost),
    );
    expect(recoveries).toBe(1);
    expect(restored.record).toMatchObject({
      state: "apply_failed",
      attempt: { attemptNo: 1 },
      hostResult: { status: "restored_failure" },
      attemptHistory: [],
    });
    const committed = await retryPersonalityProposal(proposal.id, applyDependencies(proposal));
    expect(committed.record).toMatchObject({
      state: "applied",
      attempt: { attemptNo: 2 },
      attemptHistory: [{ attemptNo: 1, terminalStatus: "restored_failure" }],
    });
  });

  it("records and restores a workspace-blocking recovery receipt instead of relabeling it corrupt", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    const blockerId = "personality:signals:prior:attempt:1";
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, fakeHost(proposal, {
      put: async () => {
        throw new HostPersonalityError(
          "workspace recovery required",
          "WORKSPACE_RECOVERY_REQUIRED",
          409,
          { transactionId: blockerId },
        );
      },
    })))).rejects.toMatchObject({
      code: "EXECUTION_ERROR",
      details: { reason: "recovery_required", transactionId: blockerId },
    });
    expect(readPersonalityStore().index.proposals[proposal.id]).toMatchObject({
      state: "apply_failed",
      failure: {
        reason: "recovery_required",
        hostRecovery: { transactionId: blockerId, status: "recovery_required" },
      },
    });

    let inspectedId: string | null = null;
    let recoveredId: string | null = null;
    const restored = await retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal, fakeHost(proposal, {
        inspect: async (id) => {
          inspectedId = id;
          return transaction(proposal, id, "recovery_required");
        },
        recover: async (id) => {
          recoveredId = id;
          return transaction(proposal, id, "restored_failure");
        },
      })),
    );
    expect(inspectedId).toBe(blockerId);
    expect(recoveredId).toBe(blockerId);
    expect(restored.record).toMatchObject({
      state: "apply_failed",
      hostResult: { status: "restored_failure" },
    });
  });

  it("makes operator discard terminal and refuses any N+1 attempt", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    const unknownHost = fakeHost(proposal, {
      put: async () => {
        throw new HostPersonalityError("connection lost", "NETWORK_ERROR", null);
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal, unknownHost))).rejects.toMatchObject({ code: "EXECUTION_ERROR" });
    const discardHost = fakeHost(proposal, {
      inspect: async (id) => transaction(proposal, id, "resolved_discarded"),
    });
    const discarded = await retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal, discardHost),
    );
    expect(discarded.record).toMatchObject({
      state: "stale",
      attempt: null,
      attemptHistory: [{ attemptNo: 1, terminalStatus: "resolved_discarded" }],
    });
    await expect(retryPersonalityProposal(
      proposal.id,
      applyDependencies(proposal),
    )).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("fails closed before PUT when current source identity or content changed", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    let puts = 0;
    const host = fakeHost(proposal, {
      put: async (id) => {
        puts += 1;
        return transaction(proposal, id);
      },
    });
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposal, host),
      loadSources: () => sources("Changed before apply"),
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source_changed" } });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[proposal.id].state).toBe("stale");
  });

  it.each([
    ["self identity", () => sources("Ada", "contact-other")],
    ["represented organization", () => sources("Ada", "contact-self", "org-other")],
  ])("fails closed before PUT when %s changed", async (_label, loadSources) => {
    const originalSources = _label === "represented organization"
      ? () => sources("Ada", "contact-self", "org-original")
      : () => sources();
    const proposal = await proposePersonalityProjection(
      {},
      proposalDependencies(originalSources),
    );
    let puts = 0;
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposal, fakeHost(proposal, {
        put: async (id) => {
          puts += 1;
          return transaction(proposal, id);
        },
      })),
      loadSources,
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "identity_mismatch" } });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[proposal.id].state).toBe("stale");
  });

  it("fails closed before PUT when the active base binding changed", async () => {
    const ids = idFactory();
    const first = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    await approvePersonalityProposal({
      proposalId: first.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(first));
    materialize(first);
    const next = await proposePersonalityProjection(
      {},
      proposalDependencies(() => sources("Ada Changed"), ids),
    );
    await withPersonalityStore((session) => {
      const bindingSet = session.index.bindings[workspace.key]!;
      session.commit({
        schemaVersion: 1,
        bindings: {
          ...session.index.bindings,
          [workspace.key]: {
            ...bindingSet,
            active: null,
            history: bindingSet.active
              ? [bindingSet.active, ...bindingSet.history]
              : bindingSet.history,
          },
        },
        proposals: session.index.proposals,
      });
    });
    let puts = 0;
    await expect(approvePersonalityProposal({
      proposalId: next.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(next, fakeHost(next, {
      put: async (id) => {
        puts += 1;
        return transaction(next, id);
      },
    })))).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "binding_changed" } });
    expect(puts).toBe(0);
    expect(readPersonalityStore().index.proposals[next.id].state).toBe("stale");
  });

  it("rejects without host mutation and reports drift and source staleness from durable state", async () => {
    const ids = idFactory();
    const proposal = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    const rejected = await rejectPersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
      note: "Needs edits",
    });
    expect(rejected.record).toMatchObject({
      state: "rejected",
      rejection: { note: "Needs edits" },
    });

    const next = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    await approvePersonalityProposal({
      proposalId: next.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(next));
    materialize(next);
    writeFileSync(join(workspace.dir, "VOICE.md"), "unmanaged new voice");
    const view = await getPersonalityBindingView({
      resolveWorkspace: async () => workspace,
      readWorkspaceFiles: readPersonalityWorkspaceFiles,
      loadSources: () => sources("Changed Ada"),
      probeCapability: async () => available,
    });
    expect(view.status).toMatchObject({
      status: "drifted",
      detail: {
        sourceStale: { self: true },
        drifted: [expect.objectContaining({ path: "VOICE.md", reason: "unmanaged_edited" })],
      },
      host: { capability: "available", version: 1 },
    });
  });

  it("reports unavailable when the resolved workspace ID replaces a stored binding identity", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    await approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal));
    materialize(proposal);

    const view = await getPersonalityBindingView({
      resolveWorkspace: async () => ({ ...workspace, id: "99" }),
      readWorkspaceFiles: readPersonalityWorkspaceFiles,
      loadSources: () => sources(),
      probeCapability: async () => available,
    });
    expect(view.status).toMatchObject({
      status: "unavailable",
      binding: null,
      detail: { unavailable: "workspace_mismatch" },
    });
  });

  it("reports committed cleanup failure and repairs it on applied-proposal replay", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    let failCleanup = true;
    let cleanupCalls = 0;
    const dependencies = {
      ...applyDependencies(proposal),
      onBindingCommitted: () => {
        cleanupCalls += 1;
        if (failCleanup) throw new Error("injected cleanup failure");
      },
    };
    await expect(approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, dependencies)).rejects.toMatchObject({
      code: "EXECUTION_ERROR",
      details: {
        bindingCommitted: true,
        cleanupRequired: true,
        bindingId: proposal.proposedBindingId,
      },
    });
    expect(readPersonalityStore().index.proposals[proposal.id].state).toBe("applied");

    failCleanup = false;
    await expect(retryPersonalityProposal(proposal.id, dependencies)).resolves.toMatchObject({
      binding: { id: proposal.proposedBindingId },
    });
    expect(cleanupCalls).toBe(2);
  });

  it("keeps current-binding artifacts byte-identical when the facade replays historical A", async () => {
    const ids = idFactory();
    const proposalA = await proposePersonalityProjection(
      {},
      proposalDependencies(() => sources("Ada A"), ids),
    );
    const appliedA = await approvePersonalityProjection({
      proposalId: proposalA.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposalA),
      loadSources: () => sources("Ada A"),
    });
    materialize(proposalA);
    expect(appliedA.binding?.id).toBe(proposalA.proposedBindingId);

    const proposalB = await proposePersonalityProjection(
      {},
      proposalDependencies(() => sources("Ada B"), ids),
    );
    const appliedB = await approvePersonalityProjection({
      proposalId: proposalB.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(proposalB),
      loadSources: () => sources("Ada B"),
    });
    materialize(proposalB);
    const artifact = createBoundArtifact(appliedB.binding!);
    const before = artifactRows(artifact);

    await expect(retryPersonalityProjection(proposalA.id, {
      ...applyDependencies(proposalA),
      loadSources: () => sources("Ada B"),
    })).resolves.toMatchObject({ binding: { id: proposalA.proposedBindingId } });
    expect(artifactRows(artifact)).toEqual(before);
  });

  it("keeps rebound artifacts byte-identical when the facade replays historical unbind", async () => {
    const ids = idFactory();
    const proposalA = await proposePersonalityProjection({}, proposalDependencies(() => sources(), ids));
    await approvePersonalityProjection({
      proposalId: proposalA.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposalA));
    materialize(proposalA);

    const unbind = await proposePersonalityUnbind(
      { kind: "tool" },
      proposalDependencies(() => sources(), ids),
    );
    await approvePersonalityProjection({
      proposalId: unbind.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(unbind));
    materialize(unbind);

    const rebound = await proposePersonalityProjection(
      {},
      proposalDependencies(() => sources("Ada rebound"), ids),
    );
    const applied = await approvePersonalityProjection({
      proposalId: rebound.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, {
      ...applyDependencies(rebound),
      loadSources: () => sources("Ada rebound"),
    });
    materialize(rebound);
    const artifact = createBoundArtifact(applied.binding!);
    const before = artifactRows(artifact);

    await expect(retryPersonalityProjection(unbind.id, {
      ...applyDependencies(unbind),
      loadSources: () => sources("Ada rebound"),
    })).resolves.toMatchObject({ binding: null });
    expect(artifactRows(artifact)).toEqual(before);
  });

  it("classifies every workspace drift family with its exact public reason", async () => {
    const proposal = await proposePersonalityProjection({}, proposalDependencies());
    await approvePersonalityProposal({
      proposalId: proposal.id,
      evidence: { kind: "ui", route: "/settings/personality" },
    }, applyDependencies(proposal));
    materialize(proposal);
    const identity = proposal.files.find((file) => file.path === "IDENTITY.md")!.proposedFile!;
    const view = () => getPersonalityBindingView({
      resolveWorkspace: async () => workspace,
      readWorkspaceFiles: readPersonalityWorkspaceFiles,
      loadSources: () => sources(),
      probeCapability: async () => available,
    });
    const reasonFor = async (path: string) => {
      const status = await view();
      return status.status.detail?.drifted?.find((entry) => entry.path === path)?.reason;
    };

    unlinkSync(join(workspace.dir, "IDENTITY.md"));
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("file_missing");
    materialize(proposal);
    writeFileSync(join(workspace.dir, "IDENTITY.md"), `${identity}\n${identity}`);
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("duplicate_block");
    materialize(proposal);
    writeFileSync(
      join(workspace.dir, "IDENTITY.md"),
      identity.replaceAll(proposal.proposedBindingId, "pb_manual99"),
    );
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("marker_binding_mismatch");
    materialize(proposal);
    writeFileSync(join(workspace.dir, "IDENTITY.md"), identity.replace("Name: Ada", "Name: Edited"));
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("block_edited");
    materialize(proposal);
    writeFileSync(join(workspace.dir, "IDENTITY.md"), `${identity}\nUser note`);
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("unmanaged_edited");
    materialize(proposal);
    writeFileSync(join(workspace.dir, "IDENTITY.md"), "User note only");
    await expect(reasonFor("IDENTITY.md")).resolves.toBe("block_missing");
    materialize(proposal);
    writeFileSync(join(workspace.dir, "VOICE.md"), "New unmanaged voice file");
    await expect(reasonFor("VOICE.md")).resolves.toBe("unmanaged_edited");
    materialize(proposal);
    unlinkSync(join(workspace.dir, "AGENTS.md"));
    await expect(reasonFor("AGENTS.md")).resolves.toBe("index_pointer_missing");
  });
});
