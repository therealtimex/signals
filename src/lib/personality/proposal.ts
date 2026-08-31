import { nanoid } from "nanoid";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  PERSONALITY_SECTIONS,
  SOCIAL_PERSONALITY_FILES,
  type PersonalityBinding,
  type PersonalityFile,
  type PersonalityIndex,
  type PersonalityProposal,
  type PersonalityProposalRecord,
  type PersonalitySection,
  personalityProposalSchema,
} from "@/lib/personality/contracts";
import {
  mergeManagedFile,
  parseManagedFile,
  unifiedDiff,
  unmanagedPersonalityContent,
} from "@/lib/personality/managed-files";
import {
  PERSONALITY_INDEX_TEXT,
  renderIndexBlock,
  renderPersonalityBlocks,
  type RenderedPersonalityBlock,
} from "@/lib/personality/render";
import {
  buildSourceSnapshot,
  computeSourceHash,
} from "@/lib/personality/snapshot";
import {
  loadPersonalitySourceBundle,
  type LoadedPersonalitySourceBundle,
} from "@/lib/personality/sources";
import {
  computeProposalHash,
  withPersonalityStore,
  type PersonalityStoreSession,
} from "@/lib/personality/store";
import {
  inspectClaudeShim,
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspace,
  type PersonalityWorkspace,
  type PersonalityWorkspaceFile,
} from "@/lib/personality/workspace";
import type { EnvLike } from "@/lib/rtx/env";
import type { ApprovalEvidence } from "@/lib/writing/contracts";
import { approvalEvidenceSchema } from "@/lib/writing/contracts";
import { sha256Canonical } from "@/lib/writing/hash";

const HOST_MAX_FILES = 16;
const HOST_MAX_FILE_BYTES = 1024 * 1024;
const HOST_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const LIVE_INTENT_STATES = new Set(["proposed", "approved", "applying", "apply_failed"]);

const FILE_SECTION = {
  "IDENTITY.md": "identity",
  "SOUL.md": "boundaries",
  "VOICE.md": "voice",
  "BRAND.md": "brand",
  "AGENTS.md": "index",
} as const satisfies Record<PersonalityFile, PersonalitySection>;

export type PersonalityProposalOrigin = {
  kind: "ui" | "tool";
  workflowRunId?: string;
  rtxThreadSlug?: string;
};

export type PersonalityProposalDependencies = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: (prefix: "prp" | "pb") => string;
  resolveWorkspace?: () => Promise<PersonalityWorkspace>;
  readWorkspaceFiles?: (workspace: PersonalityWorkspace) => PersonalityWorkspaceFile[];
  loadSources?: (options: { voiceProfileId?: string }) => LoadedPersonalitySourceBundle;
};

type DesiredBlocks = Partial<Record<PersonalitySection, RenderedPersonalityBlock | null>>;

function nowSeconds(dependencies: PersonalityProposalDependencies): number {
  return Math.floor((dependencies.now?.() ?? Date.now()) / 1_000);
}

function newId(
  prefix: "prp" | "pb",
  dependencies: PersonalityProposalDependencies,
): string {
  return dependencies.newId?.(prefix) ?? `${prefix}_${nanoid()}`;
}

function nextIndexInput(index: PersonalityIndex): Omit<PersonalityIndex, "generation" | "updatedAt"> {
  return {
    schemaVersion: 1,
    bindings: index.bindings,
    proposals: index.proposals,
  };
}

function sameIdentity(
  left: PersonalityBinding["identity"],
  right: PersonalityBinding["identity"],
): boolean {
  return left.selfContactId === right.selfContactId
    && left.representedOrgId === right.representedOrgId;
}

function resolveDependencies(dependencies: PersonalityProposalDependencies) {
  const env = dependencies.env ?? process.env;
  return {
    resolveWorkspace: dependencies.resolveWorkspace
      ?? (() => resolvePersonalityWorkspace(env, dependencies.fetchImpl ?? fetch)),
    readWorkspaceFiles: dependencies.readWorkspaceFiles ?? readPersonalityWorkspaceFiles,
    loadSources: dependencies.loadSources ?? loadPersonalitySourceBundle,
  };
}

function workspaceFileMap(
  files: PersonalityWorkspaceFile[],
): Map<PersonalityFile, PersonalityWorkspaceFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function requiredPointerFiles(desired: DesiredBlocks): string[] {
  return SOCIAL_PERSONALITY_FILES.filter((path) =>
    desired[FILE_SECTION[path]] !== null);
}

function unmanagedAgentsMentions(
  content: string | null,
  desired: DesiredBlocks,
): boolean {
  if (content === null) return false;
  const parsed = parseManagedFile("AGENTS.md", "index", content);
  const unmanaged = unmanagedPersonalityContent(content, parsed);
  const required = requiredPointerFiles(desired);
  return required.every((path) => unmanaged.includes(path))
    || unmanaged.includes(PERSONALITY_INDEX_TEXT);
}

function withDynamicIndex(
  files: Map<PersonalityFile, PersonalityWorkspaceFile>,
  desiredInput: DesiredBlocks,
): { desired: DesiredBlocks; includeIndex: boolean } {
  const agents = files.get("AGENTS.md")?.content ?? null;
  const parsed = parseManagedFile("AGENTS.md", "index", agents);
  const staticPointer = unmanagedAgentsMentions(agents, desiredInput);
  const includeIndex = parsed.spans.length > 0 || !staticPointer;
  return {
    desired: {
      ...desiredInput,
      ...(includeIndex ? { index: staticPointer ? null : renderIndexBlock() } : {}),
    },
    includeIndex,
  };
}

function activeBindingFor(
  session: PersonalityStoreSession,
  workspace: PersonalityWorkspace,
): PersonalityBinding | null {
  const bindingSet = session.index.bindings[workspace.key];
  if (!bindingSet) {
    const sameSlug = Object.values(session.index.bindings).find(
      (candidate) => candidate.workspaceSlug === workspace.slug,
    );
    if (sameSlug) {
      throw new AgentToolError("WORKSPACE_UNAVAILABLE", "Signals workspace identity changed", {
        reason: "workspace_mismatch",
      });
    }
    return null;
  }
  if (
    bindingSet.workspaceSlug !== workspace.slug
    || bindingSet.workspaceId !== workspace.id
    || bindingSet.workspaceDir !== workspace.dir
  ) {
    throw new AgentToolError("WORKSPACE_UNAVAILABLE", "Signals workspace identity changed", {
      reason: "workspace_mismatch",
    });
  }
  return bindingSet.active;
}

function desiredFromSources(bundle: LoadedPersonalitySourceBundle): {
  desired: DesiredBlocks;
  snapshot: ReturnType<typeof buildSourceSnapshot>;
  sourceHash: string;
} {
  const snapshot = buildSourceSnapshot(bundle.sources, bundle.revisions);
  const rendered = renderPersonalityBlocks(bundle.sources);
  return {
    desired: {
      identity: rendered.identity,
      boundaries: rendered.boundaries,
      voice: rendered.voice,
      brand: rendered.brand,
    },
    snapshot,
    sourceHash: computeSourceHash(snapshot),
  };
}

function activeBaseline(
  session: PersonalityStoreSession,
  active: PersonalityBinding | null,
  path: PersonalityFile,
): { fileHash: string | null; content: string | null } {
  if (!active) return { fileHash: null, content: null };
  const bindingFile = active.files.find((file) => file.path === path);
  const proposalFile = session.getProposal(active.proposalId).files.find(
    (file) => file.path === path,
  );
  return {
    fileHash: bindingFile?.fileHash ?? null,
    content: proposalFile?.proposedFile ?? null,
  };
}

function buildProposalFiles(input: {
  session: PersonalityStoreSession;
  workspaceFiles: PersonalityWorkspaceFile[];
  active: PersonalityBinding | null;
  desired: DesiredBlocks;
  includeIndex: boolean;
  bindingId: `pb_${string}`;
  sourceHash: string;
}): PersonalityProposal["files"] {
  const files = workspaceFileMap(input.workspaceFiles);
  const paths: PersonalityFile[] = [
    ...SOCIAL_PERSONALITY_FILES,
    ...(input.includeIndex ? ["AGENTS.md" as const] : []),
  ];
  let totalBytes = 0;
  const proposalFiles = paths.map((path) => {
    const section = FILE_SECTION[path];
    const current = files.get(path) ?? { path, content: null, fileHash: null, size: 0 };
    const merged = mergeManagedFile({
      path,
      section,
      currentFile: current.content,
      desiredBlock: input.desired[section] ?? null,
      bindingId: input.bindingId,
      sourceHash: input.sourceHash,
    });
    const proposedBytes = merged.proposedFile === null
      ? 0
      : Buffer.byteLength(merged.proposedFile, "utf8");
    if (proposedBytes > HOST_MAX_FILE_BYTES) {
      throw new AgentToolError("VALIDATION_ERROR", `Personality file is too large: ${path}`, {
        reason: "file_too_large",
        path,
        bytes: proposedBytes,
        maxBytes: HOST_MAX_FILE_BYTES,
      });
    }
    totalBytes += proposedBytes;
    const baseline = activeBaseline(input.session, input.active, path);
    return {
      path,
      section,
      exists: current.content !== null,
      bindingFileHash: baseline.fileHash,
      currentFileHash: current.fileHash,
      currentBlockHash: merged.currentBlockHash,
      proposedBlock: merged.proposedBlock,
      proposedBlockHash: merged.proposedBlockHash,
      proposedFile: merged.proposedFile,
      proposedFileHash: merged.proposedFileHash,
      unmanagedBytes: merged.unmanagedBytes,
      driftDiff: input.active && baseline.fileHash !== current.fileHash
        ? unifiedDiff(path, baseline.content, current.content)
        : null,
      diff: unifiedDiff(path, current.content, merged.proposedFile),
      ...(merged.repair ? { repair: merged.repair } : {}),
    };
  });
  if (proposalFiles.length > HOST_MAX_FILES || totalBytes > HOST_MAX_TOTAL_BYTES) {
    throw new AgentToolError("VALIDATION_ERROR", "Personality transaction is too large", {
      reason: "transaction_too_large",
      files: proposalFiles.length,
      bytes: totalBytes,
    });
  }
  return proposalFiles;
}

function computeIntentHash(input: {
  kind: PersonalityProposal["kind"];
  workspace: PersonalityWorkspace;
  identity: PersonalityBinding["identity"];
  basedOnBindingId: string | null;
  targetBindingId?: string | null;
  sourceHash: string;
  files: PersonalityProposal["files"];
  shim: PersonalityProposal["shim"];
}): string {
  return sha256Canonical({
    schemaVersion: 1,
    kind: input.kind,
    workspace: input.workspace,
    identity: input.identity,
    basedOnBindingId: input.basedOnBindingId,
    targetBindingId: input.targetBindingId ?? null,
    sourceHash: input.sourceHash,
    currentFiles: input.files.map((file) => [file.path, file.currentFileHash]),
    desiredBlocks: input.files.map((file) => [file.path, file.proposedBlockHash]),
    shim: input.shim,
  });
}

function findLiveIntent(
  session: PersonalityStoreSession,
  workspaceKey: string,
  intentHash: string,
): PersonalityProposal | null {
  for (const [proposalId, record] of Object.entries(session.index.proposals)) {
    if (record.workspaceKey !== workspaceKey || !LIVE_INTENT_STATES.has(record.state)) continue;
    const proposal = session.getProposal(proposalId);
    if (proposal.intentHash === intentHash) return proposal;
  }
  return null;
}

function persistProposal(
  session: PersonalityStoreSession,
  proposalInput: Omit<PersonalityProposal, "proposalHash">,
  at: number,
): PersonalityProposal {
  const provisional = { ...proposalInput, proposalHash: "0".repeat(64) };
  const proposal = personalityProposalSchema.parse({
    ...provisional,
    proposalHash: computeProposalHash(provisional),
  });
  const proposals = { ...session.index.proposals };
  for (const [proposalId, record] of Object.entries(proposals)) {
    if (
      record.workspaceKey === proposal.workspace.key
      && record.state === "proposed"
      && proposalId !== proposal.id
    ) {
      proposals[proposalId] = { ...record, state: "superseded", updatedAt: at };
    }
  }
  const record: PersonalityProposalRecord = {
    state: "proposed",
    workspaceKey: proposal.workspace.key,
    updatedAt: at,
    approval: null,
    rejection: null,
    attempt: null,
    attemptHistory: [],
    failure: null,
    hostResult: null,
  };
  proposals[proposal.id] = record;
  session.commit({ ...nextIndexInput(session.index), proposals }, [proposal]);
  return proposal;
}

function proposalWarnings(
  workspace: PersonalityWorkspace,
  files: PersonalityWorkspaceFile[],
): string[] {
  const warnings: string[] = [];
  const shim = inspectClaudeShim(workspace);
  if (shim.state === "regular_file") warnings.push("claude_md_not_symlink");
  if (files.some((file) => file.path === "AGENTS.md" && file.content === null)) {
    warnings.push("agents_md_will_be_created");
  }
  return warnings;
}

async function constructProposal(input: {
  kind: PersonalityProposal["kind"];
  voiceProfileId?: string;
  targetBindingId?: string;
  origin: PersonalityProposalOrigin;
  dependencies: PersonalityProposalDependencies;
}): Promise<PersonalityProposal> {
  const dependencies = resolveDependencies(input.dependencies);
  await dependencies.resolveWorkspace();
  if (input.kind !== "unbind") dependencies.loadSources({ voiceProfileId: input.voiceProfileId });

  return withPersonalityStore(async (session) => {
    const workspace = await dependencies.resolveWorkspace();
    const workspaceFiles = dependencies.readWorkspaceFiles(workspace);
    const active = activeBindingFor(session, workspace);
    let desired: DesiredBlocks;
    let snapshot: PersonalityProposal["sourceSnapshot"];
    let sourceHash: string;
    let identity: PersonalityBinding["identity"];
    let targetBindingId: string | null = null;

    if (input.kind === "projection") {
      const sources = dependencies.loadSources({ voiceProfileId: input.voiceProfileId });
      const rendered = desiredFromSources(sources);
      desired = rendered.desired;
      snapshot = rendered.snapshot;
      sourceHash = rendered.sourceHash;
      identity = {
        selfContactId: rendered.snapshot.self.contactId,
        representedOrgId: rendered.snapshot.org?.orgId ?? null,
      };
      if (active && !sameIdentity(active.identity, identity)) {
        throw new AgentToolError(
          "CONFLICT",
          "Unbind the active Personality before changing represented identity",
          { reason: "identity_replacement_requires_unbind", bindingId: active.id },
        );
      }
    } else if (input.kind === "rollback") {
      const bindingSet = session.index.bindings[workspace.key];
      const target = [bindingSet?.active, ...(bindingSet?.history ?? [])].find(
        (binding): binding is PersonalityBinding => binding?.id === input.targetBindingId,
      );
      if (!target) {
        throw new AgentToolError("NOT_FOUND", `Personality binding not found: ${input.targetBindingId}`);
      }
      const currentSources = dependencies.loadSources({});
      const currentSnapshot = buildSourceSnapshot(currentSources.sources, currentSources.revisions);
      const currentIdentity = {
        selfContactId: currentSnapshot.self.contactId,
        representedOrgId: currentSnapshot.org?.orgId ?? null,
      };
      if (!sameIdentity(target.identity, currentIdentity)) {
        throw new AgentToolError("CONFLICT", "Rollback identity no longer matches Signals", {
          reason: "identity_mismatch",
        });
      }
      const targetProposal = session.getProposal(target.proposalId);
      desired = Object.fromEntries(
        SOCIAL_PERSONALITY_FILES.map((path) => {
          const file = targetProposal.files.find((candidate) => candidate.path === path);
          return [
            FILE_SECTION[path],
            file?.proposedBlock === null || file?.proposedBlock === undefined
              ? null
              : { body: file.proposedBlock, blockHash: file.proposedBlockHash! },
          ];
        }),
      );
      snapshot = targetProposal.sourceSnapshot;
      sourceHash = targetProposal.sourceHash;
      identity = target.identity;
      targetBindingId = target.id;
    } else {
      desired = {
        identity: null,
        boundaries: null,
        voice: null,
        brand: null,
      };
      snapshot = null;
      sourceHash = "";
      if (active) {
        identity = active.identity;
      } else {
        const currentSources = dependencies.loadSources({});
        const currentSnapshot = buildSourceSnapshot(currentSources.sources, currentSources.revisions);
        identity = {
          selfContactId: currentSnapshot.self.contactId,
          representedOrgId: currentSnapshot.org?.orgId ?? null,
        };
      }
    }

    const indexed = withDynamicIndex(workspaceFileMap(workspaceFiles), desired);
    desired = indexed.desired;
    const proposalId = newId("prp", input.dependencies) as `prp_${string}`;
    const allocatedBindingId = newId("pb", input.dependencies) as `pb_${string}`;
    const candidateBindingId = (active?.id ?? allocatedBindingId) as `pb_${string}`;
    let files = buildProposalFiles({
      session,
      workspaceFiles,
      active,
      desired,
      includeIndex: indexed.includeIndex,
      bindingId: candidateBindingId,
      sourceHash,
    });
    const claude = inspectClaudeShim(workspace);
    const shim = {
      createClaudeSymlink: claude.state === "missing",
    };
    const candidateNoop = files.every((file) => file.diff === "")
      && SOCIAL_PERSONALITY_FILES.every((path) =>
        files.find((file) => file.path === path)?.driftDiff === null)
      && !shim.createClaudeSymlink;
    if (!candidateNoop && candidateBindingId !== allocatedBindingId) {
      files = buildProposalFiles({
        session,
        workspaceFiles,
        active,
        desired,
        includeIndex: indexed.includeIndex,
        bindingId: allocatedBindingId,
        sourceHash,
      });
    }
    const intentHash = computeIntentHash({
      kind: input.kind,
      workspace,
      identity,
      basedOnBindingId: active?.id ?? null,
      targetBindingId,
      sourceHash,
      files,
      shim,
    });
    const existing = findLiveIntent(session, workspace.key, intentHash);
    if (existing) return existing;
    const noop = candidateNoop;
    const proposedBindingId = noop && active ? active.id : allocatedBindingId;
    const at = nowSeconds(input.dependencies);
    return persistProposal(session, {
      schemaVersion: 1,
      id: proposalId,
      kind: input.kind,
      proposedBindingId,
      workspace,
      identity,
      basedOnBindingId: active?.id ?? null,
      sourceSnapshot: snapshot,
      sourceHash,
      files,
      shim,
      preflight: { warnings: proposalWarnings(workspace, workspaceFiles) },
      intentHash,
      noop,
      proposedBy: { ...input.origin, at },
    }, at);
  });
}

export async function proposePersonalityProjection(
  input: { voiceProfileId?: string; origin?: PersonalityProposalOrigin } = {},
  dependencies: PersonalityProposalDependencies = {},
): Promise<PersonalityProposal> {
  return constructProposal({
    kind: "projection",
    voiceProfileId: input.voiceProfileId,
    origin: input.origin ?? { kind: "tool" },
    dependencies,
  });
}

export async function proposePersonalityRollback(
  bindingId: string,
  origin: PersonalityProposalOrigin = { kind: "tool" },
  dependencies: PersonalityProposalDependencies = {},
): Promise<PersonalityProposal> {
  return constructProposal({
    kind: "rollback",
    targetBindingId: bindingId,
    origin,
    dependencies,
  });
}

export async function proposePersonalityUnbind(
  origin: PersonalityProposalOrigin = { kind: "tool" },
  dependencies: PersonalityProposalDependencies = {},
): Promise<PersonalityProposal> {
  return constructProposal({ kind: "unbind", origin, dependencies });
}

export async function rejectPersonalityProposal(input: {
  proposalId: string;
  evidence: ApprovalEvidence;
  note?: string;
}, dependencies: Pick<PersonalityProposalDependencies, "now"> = {}): Promise<{
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
}> {
  const evidence = approvalEvidenceSchema.parse(input.evidence);
  return withPersonalityStore((session) => {
    const record = session.index.proposals[input.proposalId];
    if (!record) throw new AgentToolError("NOT_FOUND", `Personality proposal not found: ${input.proposalId}`);
    const proposal = session.getProposal(input.proposalId);
    const rejectable = record.state === "proposed"
      || (record.state === "approved" && record.attempt === null)
      || (record.state === "apply_failed" && record.attempt?.phase === "terminal");
    if (!rejectable) {
      throw new AgentToolError("CONFLICT", "Personality proposal cannot be rejected in its current state", {
        state: record.state,
      });
    }
    const at = nowSeconds(dependencies);
    const nextRecord: PersonalityProposalRecord = {
      ...record,
      state: "rejected",
      rejection: {
        by: "user",
        at,
        evidence,
        ...(input.note ? { note: input.note } : {}),
      },
      updatedAt: at,
    };
    session.commit({
      ...nextIndexInput(session.index),
      proposals: { ...session.index.proposals, [proposal.id]: nextRecord },
    });
    return { proposal, record: nextRecord };
  });
}
