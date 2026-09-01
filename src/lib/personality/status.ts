import { AgentToolError } from "@/lib/agent-tools/types";
import {
  SOCIAL_PERSONALITY_FILES,
  type PersonalityBinding,
  type PersonalityDriftReason,
  type PersonalityIndex,
  type PersonalityProposal,
  type PersonalityStatus,
  personalityStatusSchema,
} from "@/lib/personality/contracts";
import { parseManagedFile, unmanagedPersonalityContent } from "@/lib/personality/managed-files";
import { PERSONALITY_INDEX_TEXT } from "@/lib/personality/render";
import { buildSourceSnapshot, computeSourceHash } from "@/lib/personality/snapshot";
import { loadPersonalitySourceBundle } from "@/lib/personality/sources";
import { readPersonalityStore } from "@/lib/personality/store";
import {
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspace,
  type PersonalityWorkspace,
  type PersonalityWorkspaceFile,
} from "@/lib/personality/workspace";
import { probeHostCapabilities } from "@/lib/rtx/capabilities";
import type { PersonalityCapabilityState } from "@/lib/rtx/capabilities";
import type { EnvLike } from "@/lib/rtx/env";
import { sha256Canonical } from "@/lib/writing/hash";
import { listPlatformTargets } from "@/lib/db/queries/platform-targets";
import { compatibleTargetIds } from "@/lib/personality/target-representation";
import type { PlatformTarget } from "@/lib/db/types";

export type PersonalityBindingView = {
  status: PersonalityStatus;
  history: PersonalityBinding[];
  proposals: Array<{
    proposal: PersonalityProposal;
    record: ReturnType<typeof readPersonalityStore>["index"]["proposals"][string];
    actions: PersonalityProposalActions;
  }>;
  diagnostics: { orphanProposalIds: string[] };
};

export type PersonalityProposalActions = {
  canApprove: boolean;
  canReject: boolean;
  canRetry: boolean;
  approvalBlockers: string[];
};

export type PersonalityStatusDependencies = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  resolveWorkspace?: () => Promise<PersonalityWorkspace>;
  readWorkspaceFiles?: typeof readPersonalityWorkspaceFiles;
  loadSources?: typeof loadPersonalitySourceBundle;
  probeCapability?: () => Promise<PersonalityCapabilityState>;
  listTargets?: () => PlatformTarget[];
};

const SECTION_BY_PATH = {
  "IDENTITY.md": "identity",
  "SOUL.md": "boundaries",
  "VOICE.md": "voice",
  "BRAND.md": "brand",
  "AGENTS.md": "index",
} as const;

function addDrift(
  drift: Array<{ path: string; reason: PersonalityDriftReason }>,
  path: string,
  reason: PersonalityDriftReason,
): void {
  if (!drift.some((entry) => entry.path === path && entry.reason === reason)) {
    drift.push({ path, reason });
  }
}

function socialDrift(
  binding: PersonalityBinding,
  files: Map<string, PersonalityWorkspaceFile>,
): Array<{ path: string; reason: PersonalityDriftReason }> {
  const drift: Array<{ path: string; reason: PersonalityDriftReason }> = [];
  for (const path of SOCIAL_PERSONALITY_FILES) {
    const expected = binding.files.find((file) => file.path === path);
    const current = files.get(path) ?? { path, content: null, fileHash: null, size: 0 };
    if (!expected) {
      addDrift(drift, path, "block_missing");
      continue;
    }
    if (expected.fileHash !== null && current.content === null) {
      addDrift(drift, path, "file_missing");
      continue;
    }
    if (expected.fileHash === null && current.content !== null) {
      addDrift(drift, path, "unmanaged_edited");
      continue;
    }
    if (current.content === null) continue;
    try {
      const parsed = parseManagedFile(path, SECTION_BY_PATH[path], current.content);
      if (parsed.duplicate) {
        addDrift(drift, path, "duplicate_block");
      } else if (expected.blockHash !== null && parsed.spans.length === 0) {
        addDrift(drift, path, "block_missing");
      } else if (
        expected.blockHash !== null
        && parsed.currentBindingId !== binding.id
      ) {
        addDrift(drift, path, "marker_binding_mismatch");
      } else if (
        expected.blockHash !== null
        && parsed.currentBlockHash !== expected.blockHash
      ) {
        addDrift(drift, path, "block_edited");
      } else if (current.fileHash !== expected.fileHash) {
        addDrift(drift, path, "unmanaged_edited");
      }
    } catch (error) {
      if (error instanceof AgentToolError) addDrift(drift, path, "block_missing");
      else throw error;
    }
  }
  return drift;
}

function pointerPresent(content: string | null, required: string[]): boolean {
  if (content === null) return false;
  try {
    const parsed = parseManagedFile("AGENTS.md", "index", content);
    const unmanaged = unmanagedPersonalityContent(content, parsed);
    return unmanaged.includes(PERSONALITY_INDEX_TEXT)
      || required.every((path) => unmanaged.includes(path));
  } catch {
    return false;
  }
}

function indexDrift(
  binding: PersonalityBinding,
  proposal: PersonalityProposal,
  files: Map<string, PersonalityWorkspaceFile>,
): Array<{ path: string; reason: PersonalityDriftReason }> {
  const expected = binding.files.find((file) => file.path === "AGENTS.md");
  const current = files.get("AGENTS.md")?.content ?? null;
  if (!expected) {
    const required = SOCIAL_PERSONALITY_FILES.filter((path) =>
      proposal.files.find((file) => file.path === path)?.proposedBlock !== null);
    return pointerPresent(current, required)
      ? []
      : [{ path: "AGENTS.md", reason: "index_pointer_missing" }];
  }
  if (current === null || expected.blockHash === null) {
    return [{ path: "AGENTS.md", reason: "index_pointer_missing" }];
  }
  try {
    const parsed = parseManagedFile("AGENTS.md", "index", current);
    return parsed.spans.length === 1
      && parsed.currentBindingId === binding.id
      && parsed.currentBlockHash === expected.blockHash
      ? []
      : [{ path: "AGENTS.md", reason: "index_pointer_missing" }];
  } catch {
    return [{ path: "AGENTS.md", reason: "index_pointer_missing" }];
  }
}

function sourcePart(value: unknown): string {
  return sha256Canonical(value);
}

function sameIdentity(
  left: PersonalityProposal["identity"],
  right: PersonalityProposal["identity"],
): boolean {
  return left.selfContactId === right.selfContactId
    && left.representedOrgId === right.representedOrgId;
}

function proposalActions(input: {
  proposal: PersonalityProposal;
  record: PersonalityBindingView["proposals"][number]["record"];
  workspace: PersonalityWorkspace;
  workspaceFiles: PersonalityWorkspaceFile[];
  activeBinding: PersonalityBinding | null;
  host: PersonalityStatus["host"];
  loadSources: typeof loadPersonalitySourceBundle;
}): PersonalityProposalActions {
  const blockers: string[] = [];
  const { proposal, record, workspace, activeBinding } = input;

  if (record.state !== "proposed") blockers.push(`state_${record.state}`);
  if (proposal.noop) blockers.push("proposal_noop");
  if (input.host.capability !== "available") blockers.push("host_capability_unavailable");
  if (
    proposal.workspace.slug !== workspace.slug
    || proposal.workspace.id !== workspace.id
    || proposal.workspace.dir !== workspace.dir
    || proposal.workspace.key !== workspace.key
  ) {
    blockers.push("workspace_mismatch");
  }
  if (proposal.basedOnBindingId !== (activeBinding?.id ?? null)) {
    blockers.push("binding_changed");
  }

  const fileHashes = new Map(
    input.workspaceFiles.map((file) => [file.path, file.fileHash]),
  );
  if (proposal.files.some((file) => (fileHashes.get(file.path) ?? null) !== file.currentFileHash)) {
    blockers.push("file_changed");
  }

  try {
    if (proposal.kind === "unbind") {
      if (!activeBinding || !sameIdentity(activeBinding.identity, proposal.identity)) {
        blockers.push("identity_changed");
      }
    } else {
      const voiceProfileId = proposal.kind === "projection"
        ? proposal.sourceSnapshot?.voice?.id
        : undefined;
      const sources = input.loadSources(voiceProfileId ? { voiceProfileId } : {});
      const snapshot = buildSourceSnapshot(sources.sources, sources.revisions);
      const identity = {
        selfContactId: snapshot.self.contactId,
        representedOrgId: snapshot.org?.orgId ?? null,
      };
      if (!sameIdentity(identity, proposal.identity)) blockers.push("identity_changed");
      if (proposal.kind === "projection" && computeSourceHash(snapshot) !== proposal.sourceHash) {
        blockers.push("source_changed");
      }
    }
  } catch {
    blockers.push("source_unavailable");
  }

  const approvalBlockers = [...new Set(blockers)];
  const canReject = record.state === "proposed"
    || (record.state === "approved" && record.attempt === null)
    || (record.state === "apply_failed" && record.attempt?.phase === "terminal");
  const canRetry = record.state === "apply_failed"
    && record.attempt !== null
    && (
      record.hostResult?.status === "restored_failure"
      || record.hostResult?.status === "recovery_required"
      || record.failure?.hostRecovery?.status === "recovery_required"
    );
  return {
    canApprove: approvalBlockers.length === 0,
    canReject,
    canRetry,
    approvalBlockers,
  };
}

function sourceStaleDetail(
  bindingProposal: PersonalityProposal,
  loadSources: typeof loadPersonalitySourceBundle,
): { currentSourceHash: string | null; detail: NonNullable<PersonalityStatus["detail"]>["sourceStale"] } {
  try {
    const voiceProfileId = bindingProposal.kind === "projection"
      ? bindingProposal.sourceSnapshot?.voice?.id
      : undefined;
    const bundle = loadSources(voiceProfileId ? { voiceProfileId } : {});
    const current = buildSourceSnapshot(bundle.sources, bundle.revisions);
    const expected = bindingProposal.sourceSnapshot;
    if (!expected) return { currentSourceHash: computeSourceHash(current), detail: {} };
    const detail = {
      ...(sourcePart({ id: current.self.contactId, input: current.self.input })
        !== sourcePart({ id: expected.self.contactId, input: expected.self.input })
        ? { self: true }
        : {}),
      ...(sourcePart(current.org && { id: current.org.orgId, input: current.org.input })
        !== sourcePart(expected.org && { id: expected.org.orgId, input: expected.org.input })
        ? { org: true }
        : {}),
      ...(sourcePart(current.voice) !== sourcePart(expected.voice) ? { voice: true } : {}),
      ...(sourcePart(current.statements) !== sourcePart(expected.statements) ? { statements: true } : {}),
    };
    return { currentSourceHash: computeSourceHash(current), detail };
  } catch (error) {
    const reason = error instanceof AgentToolError
      ? (error.details as { reason?: string } | undefined)?.reason
      : null;
    return {
      currentSourceHash: null,
      detail: reason === "org_not_represented"
        ? { org: true }
        : reason === "voice_not_self_owned"
          ? { voice: true }
          : error instanceof AgentToolError && error.code === "STORE_CONFLICT"
            ? { statements: true }
            : { self: true },
    };
  }
}

async function hostView(
  env: EnvLike,
  fetchImpl: typeof fetch,
  probe?: () => Promise<PersonalityCapabilityState>,
) {
  const capability = await (probe?.() ?? probeHostCapabilities({ env, fetchImpl }));
  return { capability: capability.state, version: capability.version };
}

export type PersonalityStatusCoreInput = {
  workspace: PersonalityWorkspace;
  index: PersonalityIndex;
  getProposal: (proposalId: string) => PersonalityProposal | undefined;
  readFiles: typeof readPersonalityWorkspaceFiles;
  loadSources: typeof loadPersonalitySourceBundle;
  targets: PlatformTarget[];
  host: PersonalityStatus["host"];
};

export function computePersonalityStatus(input: PersonalityStatusCoreInput): PersonalityStatus {
  const bindingSet = input.index.bindings[input.workspace.key];
  if (!bindingSet) {
    const mismatch = Object.values(input.index.bindings).some(
      (candidate) => candidate.workspaceSlug === input.workspace.slug,
    );
    return personalityStatusSchema.parse({
      workspace: { slug: input.workspace.slug, dir: input.workspace.dir },
      binding: null,
      currentSourceHash: null,
      status: mismatch ? "unavailable" : "unbound",
      ...(mismatch ? { detail: { unavailable: "workspace_mismatch" } } : {}),
      compatibleTargets: [],
      host: input.host,
    });
  }
  if (
    bindingSet.workspaceSlug !== input.workspace.slug
    || bindingSet.workspaceId !== input.workspace.id
    || bindingSet.workspaceDir !== input.workspace.dir
  ) {
    return personalityStatusSchema.parse({
      workspace: { slug: input.workspace.slug, dir: input.workspace.dir },
      binding: null,
      currentSourceHash: null,
      status: "unavailable",
      detail: { unavailable: "workspace_mismatch" },
      compatibleTargets: [],
      host: input.host,
    });
  }
  const active = bindingSet.active;
  if (!active) {
    return personalityStatusSchema.parse({
      workspace: { slug: input.workspace.slug, dir: input.workspace.dir },
      binding: null,
      currentSourceHash: null,
      status: "unbound",
      compatibleTargets: [],
      host: input.host,
    });
  }
  const bindingProposal = input.getProposal(active.proposalId);
  if (!bindingProposal) {
    throw new AgentToolError("STORE_CONFLICT", "Active Personality proposal is missing", {
      reason: "store_corrupt",
    });
  }
  const workspaceFiles = new Map(input.readFiles(input.workspace).map((file) => [file.path, file]));
  const drift = [
    ...socialDrift(active, workspaceFiles),
    ...indexDrift(active, bindingProposal, workspaceFiles),
  ];
  const source = sourceStaleDetail(bindingProposal, input.loadSources);
  const isSourceStale = source.currentSourceHash !== active.sourceHash
    || Object.keys(source.detail ?? {}).length > 0;
  return personalityStatusSchema.parse({
    workspace: { slug: input.workspace.slug, dir: input.workspace.dir },
    binding: {
      id: active.id,
      sourceHash: active.sourceHash,
      personalityHash: active.personalityHash,
      appliedAt: active.appliedAt,
      identity: active.identity,
      files: active.files,
    },
    currentSourceHash: source.currentSourceHash,
    status: drift.length > 0 ? "drifted" : isSourceStale ? "source_stale" : "bound",
    ...(
      drift.length > 0 || isSourceStale
        ? { detail: {
            ...(isSourceStale ? { sourceStale: source.detail } : {}),
            ...(drift.length > 0 ? { drifted: drift } : {}),
          } }
        : {}
    ),
    compatibleTargets: compatibleTargetIds(input.targets, active.identity),
    host: input.host,
  });
}

export async function getPersonalityBindingView(
  dependencies: PersonalityStatusDependencies = {},
): Promise<PersonalityBindingView> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveWorkspace = dependencies.resolveWorkspace
    ?? (() => resolvePersonalityWorkspace(env, fetchImpl));
  const readFiles = dependencies.readWorkspaceFiles ?? readPersonalityWorkspaceFiles;
  const loadSources = dependencies.loadSources ?? loadPersonalitySourceBundle;
  const listTargets = dependencies.listTargets ?? (() => listPlatformTargets());
  const host = await hostView(env, fetchImpl, dependencies.probeCapability);
  let workspace: PersonalityWorkspace;
  try {
    workspace = await resolveWorkspace();
  } catch (error) {
    return {
      status: personalityStatusSchema.parse({
        workspace: { slug: env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals", dir: null },
        binding: null,
        currentSourceHash: null,
        status: "unavailable",
        detail: { unavailable: error instanceof Error ? error.message : "Workspace unavailable" },
        compatibleTargets: [],
        host,
      }),
      history: [],
      proposals: [],
      diagnostics: { orphanProposalIds: [] },
    };
  }
  const store = readPersonalityStore();
  const proposalRecords = Object.entries(store.index.proposals)
    .flatMap(([id, record]) => record.workspaceKey === workspace.key
      ? [{ proposal: store.proposals.get(id)!, record }]
      : [])
    .sort((left, right) => right.record.updatedAt - left.record.updatedAt);
  const workspaceFiles = readFiles(workspace);
  const status = computePersonalityStatus({
    workspace,
    index: store.index,
    getProposal: (proposalId) => store.proposals.get(proposalId),
    readFiles: () => workspaceFiles,
    loadSources,
    targets: listTargets(),
    host,
  });
  const bindingSet = store.index.bindings[workspace.key];
  const workspaceMismatch = status.status === "unavailable"
    && status.detail?.unavailable === "workspace_mismatch";
  const proposals = proposalRecords.map((view) => ({
    ...view,
    actions: proposalActions({
      ...view,
      workspace,
      workspaceFiles,
      activeBinding: bindingSet?.active ?? null,
      host: status.host,
      loadSources,
    }),
  }));
  return {
    status,
    history: workspaceMismatch ? [] : bindingSet?.history ?? [],
    proposals: workspaceMismatch ? [] : proposals,
    diagnostics: { orphanProposalIds: store.orphanProposalIds },
  };
}
