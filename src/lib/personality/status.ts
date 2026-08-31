import { AgentToolError } from "@/lib/agent-tools/types";
import {
  SOCIAL_PERSONALITY_FILES,
  type PersonalityBinding,
  type PersonalityDriftReason,
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

export type PersonalityBindingView = {
  status: PersonalityStatus;
  history: PersonalityBinding[];
  proposals: Array<{
    proposal: PersonalityProposal;
    record: ReturnType<typeof readPersonalityStore>["index"]["proposals"][string];
  }>;
  diagnostics: { orphanProposalIds: string[] };
};

export type PersonalityStatusDependencies = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  resolveWorkspace?: () => Promise<PersonalityWorkspace>;
  readWorkspaceFiles?: typeof readPersonalityWorkspaceFiles;
  loadSources?: typeof loadPersonalitySourceBundle;
  probeCapability?: () => Promise<PersonalityCapabilityState>;
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

export async function getPersonalityBindingView(
  dependencies: PersonalityStatusDependencies = {},
): Promise<PersonalityBindingView> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveWorkspace = dependencies.resolveWorkspace
    ?? (() => resolvePersonalityWorkspace(env, fetchImpl));
  const readFiles = dependencies.readWorkspaceFiles ?? readPersonalityWorkspaceFiles;
  const loadSources = dependencies.loadSources ?? loadPersonalitySourceBundle;
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
  const bindingSet = store.index.bindings[workspace.key];
  if (!bindingSet) {
    const mismatch = Object.values(store.index.bindings).some(
      (candidate) => candidate.workspaceSlug === workspace.slug,
    );
    const proposals = Object.entries(store.index.proposals)
      .flatMap(([id, record]) => record.workspaceKey === workspace.key
        ? [{ proposal: store.proposals.get(id)!, record }]
        : [])
      .sort((left, right) => right.record.updatedAt - left.record.updatedAt);
    return {
      status: personalityStatusSchema.parse({
        workspace: { slug: workspace.slug, dir: workspace.dir },
        binding: null,
        currentSourceHash: null,
        status: mismatch ? "unavailable" : "unbound",
        ...(mismatch ? { detail: { unavailable: "workspace_mismatch" } } : {}),
        compatibleTargets: [],
        host,
      }),
      history: [],
      proposals,
      diagnostics: { orphanProposalIds: store.orphanProposalIds },
    };
  }
  if (
    bindingSet.workspaceSlug !== workspace.slug
    || bindingSet.workspaceId !== workspace.id
    || bindingSet.workspaceDir !== workspace.dir
  ) {
    return {
      status: personalityStatusSchema.parse({
        workspace: { slug: workspace.slug, dir: workspace.dir },
        binding: null,
        currentSourceHash: null,
        status: "unavailable",
        detail: { unavailable: "workspace_mismatch" },
        compatibleTargets: [],
        host,
      }),
      history: [],
      proposals: [],
      diagnostics: { orphanProposalIds: store.orphanProposalIds },
    };
  }
  const active = bindingSet.active;
  const proposals = Object.entries(store.index.proposals)
    .flatMap(([id, record]) => record.workspaceKey === workspace.key
      ? [{ proposal: store.proposals.get(id)!, record }]
      : [])
    .sort((left, right) => right.record.updatedAt - left.record.updatedAt);
  if (!active) {
    return {
      status: personalityStatusSchema.parse({
        workspace: { slug: workspace.slug, dir: workspace.dir },
        binding: null,
        currentSourceHash: null,
        status: "unbound",
        compatibleTargets: [],
        host,
      }),
      history: bindingSet.history,
      proposals,
      diagnostics: { orphanProposalIds: store.orphanProposalIds },
    };
  }
  const bindingProposal = store.proposals.get(active.proposalId);
  if (!bindingProposal) {
    throw new AgentToolError("STORE_CONFLICT", "Active Personality proposal is missing", {
      reason: "store_corrupt",
    });
  }
  const workspaceFiles = new Map(readFiles(workspace).map((file) => [file.path, file]));
  const drift = [
    ...socialDrift(active, workspaceFiles),
    ...indexDrift(active, bindingProposal, workspaceFiles),
  ];
  const source = sourceStaleDetail(bindingProposal, loadSources);
  const isSourceStale = source.currentSourceHash !== active.sourceHash
    || Object.keys(source.detail ?? {}).length > 0;
  return {
    status: personalityStatusSchema.parse({
      workspace: { slug: workspace.slug, dir: workspace.dir },
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
      compatibleTargets: [],
      host,
    }),
    history: bindingSet.history,
    proposals,
    diagnostics: { orphanProposalIds: store.orphanProposalIds },
  };
}
