import { AgentToolError } from "@/lib/agent-tools/types";
import {
  SOCIAL_PERSONALITY_FILES,
  type HostCapabilityRef,
  type PersonalityBinding,
  type PersonalityIndex,
  type PersonalityProposal,
  type PersonalityProposalRecord,
  personalityProposalSchema,
} from "@/lib/personality/contracts";
import {
  HostPersonalityError,
  PersonalityHostClient,
  type HostPersonalityListing,
  type HostPersonalityTransaction,
} from "@/lib/personality/host-client";
import { parseManagedFile } from "@/lib/personality/managed-files";
import { buildSourceSnapshot, computeSourceHash, sourceRevisions } from "@/lib/personality/snapshot";
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
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspace,
  type PersonalityWorkspace,
} from "@/lib/personality/workspace";
import {
  probeHostCapabilities,
  type PersonalityCapabilityState,
} from "@/lib/rtx/capabilities";
import type { EnvLike } from "@/lib/rtx/env";
import {
  approvalEvidenceSchema,
  type ApprovalEvidence,
} from "@/lib/writing/contracts";
import { sha256, sha256Canonical } from "@/lib/writing/hash";

const FILE_SECTION = {
  "IDENTITY.md": "identity",
  "SOUL.md": "boundaries",
  "VOICE.md": "voice",
  "BRAND.md": "brand",
  "AGENTS.md": "index",
} as const;

export type PersonalityApplyResult = {
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
  binding: PersonalityBinding | null;
};

export type PersonalityApplyDependencies = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  resolveWorkspace?: () => Promise<PersonalityWorkspace>;
  readWorkspaceFiles?: typeof readPersonalityWorkspaceFiles;
  loadSources?: (options?: { voiceProfileId?: string }) => LoadedPersonalitySourceBundle;
  probeCapability?: (uncached: boolean) => Promise<PersonalityCapabilityState>;
  hostClient?: PersonalityHostClient;
  onBindingCommitted?: (
    result: PersonalityApplyResult,
    context: { activeBindingId: string | null },
  ) => Promise<void> | void;
};

type Attempt = NonNullable<PersonalityProposalRecord["attempt"]>;
type AttemptHistory = PersonalityProposalRecord["attemptHistory"][number];

function atSeconds(dependencies: PersonalityApplyDependencies): number {
  return Math.floor((dependencies.now?.() ?? Date.now()) / 1_000);
}

function nextIndexInput(index: PersonalityIndex): Omit<PersonalityIndex, "generation" | "updatedAt"> {
  return { schemaVersion: 1, bindings: index.bindings, proposals: index.proposals };
}

function updateRecord(
  session: PersonalityStoreSession,
  proposalId: string,
  record: PersonalityProposalRecord,
): PersonalityProposalRecord {
  session.commit({
    ...nextIndexInput(session.index),
    proposals: { ...session.index.proposals, [proposalId]: record },
  });
  return record;
}

function sameIdentity(
  left: PersonalityProposal["identity"],
  right: PersonalityProposal["identity"],
): boolean {
  return left.selfContactId === right.selfContactId
    && left.representedOrgId === right.representedOrgId;
}

function bindingSetFor(session: PersonalityStoreSession, proposal: PersonalityProposal) {
  const bindingSet = session.index.bindings[proposal.workspace.key];
  if (!bindingSet) return null;
  if (
    bindingSet.workspaceSlug !== proposal.workspace.slug
    || bindingSet.workspaceId !== proposal.workspace.id
    || bindingSet.workspaceDir !== proposal.workspace.dir
  ) {
    throw new AgentToolError("WORKSPACE_UNAVAILABLE", "Stored Personality workspace identity changed", {
      reason: "workspace_mismatch",
    });
  }
  return bindingSet;
}

function appliedBindingFor(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
): PersonalityBinding | null {
  const bindingSet = bindingSetFor(session, proposal);
  const binding = [bindingSet?.active, ...(bindingSet?.history ?? [])].find(
    (candidate): candidate is PersonalityBinding =>
      candidate?.proposalId === proposal.id
      && candidate.id === proposal.proposedBindingId,
  );
  if (!binding) {
    throw new AgentToolError("STORE_CONFLICT", "Applied Personality binding is missing", {
      reason: "store_corrupt",
      proposalId: proposal.id,
    });
  }
  return proposal.kind === "unbind" ? null : binding;
}

function assertBaseBinding(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
): PersonalityBinding | null {
  const active = bindingSetFor(session, proposal)?.active ?? null;
  if ((active?.id ?? null) !== proposal.basedOnBindingId) {
    throw new AgentToolError("CONFLICT", "Personality proposal base binding changed", {
      reason: "binding_changed",
      expected: proposal.basedOnBindingId,
      current: active?.id ?? null,
    });
  }
  return active;
}

function assertProposalProvenance(proposal: PersonalityProposal): void {
  if (computeProposalHash(proposal) !== proposal.proposalHash) {
    throw new AgentToolError("STORE_CONFLICT", "Personality proposal hash is invalid", {
      reason: "store_corrupt",
      proposalId: proposal.id,
    });
  }
  const reparsed = personalityProposalSchema.safeParse(proposal);
  if (!reparsed.success) {
    throw new AgentToolError("STORE_CONFLICT", "Personality proposal contract is invalid", {
      reason: "store_corrupt",
      proposalId: proposal.id,
    });
  }
  for (const file of proposal.files) {
    const actualHash = file.proposedFile === null
      ? null
      : sha256(Buffer.from(file.proposedFile, "utf8"));
    if (actualHash !== file.proposedFileHash) {
      throw new AgentToolError("STORE_CONFLICT", "Personality proposal file hash is invalid", {
        reason: "store_corrupt",
        proposalId: proposal.id,
        path: file.path,
      });
    }
    const parsed = parseManagedFile(file.path, FILE_SECTION[file.path], file.proposedFile);
    if (file.proposedBlock === null) {
      if (file.proposedBlockHash !== null || parsed.spans.length !== 0) {
        throw new AgentToolError("STORE_CONFLICT", "Personality proposal removal is invalid", {
          reason: "store_corrupt",
          path: file.path,
        });
      }
      continue;
    }
    const span = parsed.spans[0];
    const expectedSource = file.section === "index" ? null : proposal.sourceHash.slice(0, 12);
    if (
      parsed.spans.length !== 1
      || span?.bindingId !== proposal.proposedBindingId
      || span?.sourceHashPrefix !== expectedSource
      || span?.body !== file.proposedBlock
      || span?.blockHash !== file.proposedBlockHash
    ) {
      throw new AgentToolError("STORE_CONFLICT", "Personality proposal marker provenance is invalid", {
        reason: "store_corrupt",
        path: file.path,
      });
    }
  }
  const socialPaths = proposal.files.filter((file) =>
    SOCIAL_PERSONALITY_FILES.includes(file.path as (typeof SOCIAL_PERSONALITY_FILES)[number]));
  if (socialPaths.length !== SOCIAL_PERSONALITY_FILES.length) {
    throw new AgentToolError("STORE_CONFLICT", "Personality proposal does not cover all social files", {
      reason: "store_corrupt",
    });
  }
}

function assertWorkspace(
  resolved: PersonalityWorkspace,
  proposal: PersonalityProposal,
): void {
  if (
    resolved.slug !== proposal.workspace.slug
    || resolved.id !== proposal.workspace.id
    || resolved.dir !== proposal.workspace.dir
    || resolved.key !== proposal.workspace.key
  ) {
    throw new AgentToolError("CONFLICT", "Personality proposal workspace changed", {
      reason: "workspace_mismatch",
    });
  }
}

function currentSourceIdentity(bundle: LoadedPersonalitySourceBundle) {
  const snapshot = buildSourceSnapshot(bundle.sources, bundle.revisions);
  return {
    snapshot,
    identity: {
      selfContactId: snapshot.self.contactId,
      representedOrgId: snapshot.org?.orgId ?? null,
    },
  };
}

function loadSourcesForGuard(
  proposal: PersonalityProposal,
  loadSources: NonNullable<PersonalityApplyDependencies["loadSources"]>,
): LoadedPersonalitySourceBundle {
  const voiceProfileId = proposal.kind === "projection"
    ? proposal.sourceSnapshot?.voice?.id
    : undefined;
  try {
    return loadSources(voiceProfileId ? { voiceProfileId } : {});
  } catch (error) {
    const reason = error instanceof AgentToolError
      ? (error.details as { reason?: string } | undefined)?.reason
      : null;
    if (proposal.kind === "projection" && reason === "voice_not_self_owned") {
      const current = currentSourceIdentity(loadSources({}));
      if (!sameIdentity(current.identity, proposal.identity)) {
        throw new AgentToolError("CONFLICT", "Personality represented identity changed", {
          reason: "identity_mismatch",
        });
      }
      throw new AgentToolError("CONFLICT", "Personality sources changed after proposal", {
        reason: "source_changed",
      });
    }
    throw error;
  }
}

function assertSourceGuard(
  proposal: PersonalityProposal,
  active: PersonalityBinding | null,
  loadSources: PersonalityApplyDependencies["loadSources"],
): void {
  if (proposal.kind === "unbind") {
    if (!active || !sameIdentity(active.identity, proposal.identity)) {
      throw new AgentToolError("CONFLICT", "Active Personality binding changed before unbind", {
        reason: "binding_changed",
      });
    }
    return;
  }
  const current = currentSourceIdentity(loadSourcesForGuard(
    proposal,
    loadSources ?? loadPersonalitySourceBundle,
  ));
  if (!sameIdentity(current.identity, proposal.identity)) {
    throw new AgentToolError("CONFLICT", "Personality represented identity changed", {
      reason: "identity_mismatch",
    });
  }
  if (
    proposal.kind === "projection"
    && computeSourceHash(current.snapshot) !== proposal.sourceHash
  ) {
    throw new AgentToolError("CONFLICT", "Personality sources changed after proposal", {
      reason: "source_changed",
    });
  }
}

function capabilityError(capability: PersonalityCapabilityState): AgentToolError {
  return new AgentToolError(
    "CAPABILITY_UNSUPPORTED",
    "RealTimeX Personality transactions are not available",
    { reason: "host_capability_unavailable", capability: capability.state },
  );
}

function assertCapabilityLimits(
  proposal: PersonalityProposal,
  capability: PersonalityCapabilityState,
): HostCapabilityRef {
  if (capability.state !== "available" || !capability.ref) throw capabilityError(capability);
  const totalBytes = proposal.files.reduce(
    (total, file) => total + (file.proposedFile === null ? 0 : Buffer.byteLength(file.proposedFile, "utf8")),
    0,
  );
  if (
    capability.maxFiles === null
    || capability.maxFileBytes === null
    || proposal.files.length > capability.maxFiles
    || totalBytes > capability.maxTotalBytes
    || proposal.files.some((file) =>
      file.proposedFile !== null
      && Buffer.byteLength(file.proposedFile, "utf8") > capability.maxFileBytes!)
  ) {
    throw new AgentToolError("VALIDATION_ERROR", "Personality proposal exceeds host limits", {
      reason: "transaction_too_large",
    });
  }
  return capability.ref;
}

function hostListingHashes(listing: HostPersonalityListing): Map<string, string | null> {
  const expectedKeys = new Set<string>([
    ...SOCIAL_PERSONALITY_FILES,
    "AGENTS.md",
  ].map((path) => path.toLowerCase()));
  const hashes = new Map<string, string | null>();
  for (const file of listing.files) {
    const key = file.path.toLowerCase();
    if (expectedKeys.has(key) && file.path !== [...SOCIAL_PERSONALITY_FILES, "AGENTS.md"].find(
      (path) => path.toLowerCase() === key,
    )) {
      throw new AgentToolError("CONFLICT", "Host reported a case-aliased Personality path", {
        reason: "workspace_mismatch",
        path: file.path,
      });
    }
    if (hashes.has(file.path)) {
      throw new AgentToolError("CONFLICT", "Host reported a duplicate Personality path", {
        reason: "workspace_mismatch",
        path: file.path,
      });
    }
    hashes.set(file.path, file.fileHash);
  }
  return hashes;
}

function assertHostListing(
  proposal: PersonalityProposal,
  listing: HostPersonalityListing,
): void {
  if (
    listing.workspace.slug !== proposal.workspace.slug
    || String(listing.workspace.id) !== String(proposal.workspace.id)
    || listing.workspace.dir !== proposal.workspace.dir
  ) {
    throw new AgentToolError("CONFLICT", "RealTimeX workspace identity changed", {
      reason: "workspace_mismatch",
    });
  }
  const hashes = hostListingHashes(listing);
  for (const file of proposal.files) {
    if ((hashes.get(file.path) ?? null) !== file.currentFileHash) {
      throw new AgentToolError("CONFLICT", "Personality workspace files changed after proposal", {
        reason: "file_changed",
        path: file.path,
      });
    }
  }
}

function exactCommittedResult(
  proposal: PersonalityProposal,
  transaction: HostPersonalityTransaction,
  transactionId: string,
): boolean {
  if (
    transaction.status !== "committed"
    || transaction.transactionId !== transactionId
    || transaction.workspace.slug !== proposal.workspace.slug
    || String(transaction.workspace.id) !== String(proposal.workspace.id)
    || transaction.workspace.dir !== proposal.workspace.dir
    || transaction.files.length !== proposal.files.length
  ) return false;
  const results = new Map(
    transaction.files.flatMap((file) => "fileHash" in file ? [[file.path, file.fileHash] as const] : []),
  );
  return results.size === proposal.files.length
    && proposal.files.every((file) => results.get(file.path) === file.proposedFileHash);
}

function hostResult(transaction: HostPersonalityTransaction): PersonalityProposalRecord["hostResult"] {
  return {
    status: transaction.status,
    shim: transaction.shim,
    replayed: transaction.replayed,
  };
}

function personalityHash(proposal: PersonalityProposal): string {
  return sha256Canonical(SOCIAL_PERSONALITY_FILES.map((path) => [
    path,
    proposal.files.find((file) => file.path === path)?.proposedFileHash ?? null,
  ]));
}

function archiveAttempt(
  record: PersonalityProposalRecord,
  status: AttemptHistory["terminalStatus"],
  at: number,
): AttemptHistory[] {
  if (!record.attempt) return record.attemptHistory;
  return [
    ...record.attemptHistory,
    {
      bindingId: record.attempt.bindingId,
      attemptNo: record.attempt.attemptNo,
      hostTransactionId: record.attempt.hostTransactionId,
      startedAt: record.attempt.startedAt,
      finishedAt: at,
      terminalStatus: status,
      hostCapability: record.attempt.hostCapability,
      failure: record.failure,
      hostResult: record.hostResult,
    },
  ].slice(-50);
}

function failedRecord(
  record: PersonalityProposalRecord,
  transaction: HostPersonalityTransaction,
  at: number,
): PersonalityProposalRecord {
  return {
    ...record,
    state: "apply_failed",
    updatedAt: at,
    attempt: record.attempt ? { ...record.attempt, phase: "terminal" } : null,
    failure: {
      step: transaction.status === "recovery_required" ? "host_recovery" : "host_commit",
      reason: transaction.reason ?? transaction.status,
      hostRecovery: {
        transactionId: transaction.transactionId,
        status: transaction.status,
      },
    },
    hostResult: hostResult(transaction),
  };
}

function staleRecord(
  record: PersonalityProposalRecord,
  reason: string,
  at: number,
  transaction?: HostPersonalityTransaction,
): PersonalityProposalRecord {
  const withTerminal = transaction && transaction.status === "resolved_discarded"
    ? {
        ...record,
        failure: { step: "host_commit", reason },
        hostResult: hostResult(transaction),
      }
    : record;
  return {
    ...withTerminal,
    state: "stale",
    updatedAt: at,
    attemptHistory: transaction?.status === "resolved_discarded"
      ? archiveAttempt(withTerminal, "resolved_discarded", at)
      : record.attemptHistory,
    attempt: null,
  };
}

function transactionId(proposal: PersonalityProposal, attemptNo: number): string {
  return `personality:${proposal.workspace.key}:${proposal.id}:attempt:${attemptNo}`;
}

function allocateAttempt(
  record: PersonalityProposalRecord,
  proposal: PersonalityProposal,
  capability: HostCapabilityRef,
  at: number,
): PersonalityProposalRecord {
  const attemptNo = (record.attempt?.attemptNo ?? record.attemptHistory.at(-1)?.attemptNo ?? 0) + 1;
  return {
    ...record,
    state: "applying",
    updatedAt: at,
    attempt: {
      bindingId: proposal.proposedBindingId,
      attemptNo,
      hostTransactionId: transactionId(proposal, attemptNo),
      hostCapability: capability,
      phase: "prepared",
      startedAt: at,
    },
    failure: null,
    hostResult: null,
  };
}

function successfulBinding(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
  record: PersonalityProposalRecord,
  transaction: HostPersonalityTransaction,
  at: number,
): PersonalityApplyResult {
  if (!record.approval || !record.attempt) {
    throw new AgentToolError("STORE_CONFLICT", "Applied Personality proposal is missing its journal", {
      reason: "store_corrupt",
    });
  }
  const active = bindingSetFor(session, proposal)?.active ?? null;
  if ((active?.id ?? null) !== proposal.basedOnBindingId) {
    throw new AgentToolError("STORE_CONFLICT", "Applied Personality proposal base binding changed", {
      reason: "store_corrupt",
    });
  }
  const binding: PersonalityBinding = {
    schemaVersion: 1,
    id: proposal.proposedBindingId,
    proposalId: proposal.id,
    kind: proposal.kind,
    workspace: proposal.workspace,
    identity: proposal.identity,
    sourceHash: proposal.sourceHash,
    sourceRevisions: proposal.sourceSnapshot ? sourceRevisions(proposal.sourceSnapshot) : null,
    files: proposal.files.map((file) => ({
      path: file.path,
      section: file.section,
      fileHash: file.proposedFileHash,
      blockHash: file.proposedBlockHash,
    })),
    personalityHash: personalityHash(proposal),
    approval: record.approval,
    appliedAt: at,
    previousBindingId: active?.id ?? null,
    hostTransactionId: record.attempt.hostTransactionId,
    attemptNo: record.attempt.attemptNo,
    hostCapability: record.attempt.hostCapability,
  };
  const existingSet = bindingSetFor(session, proposal);
  const priorHistory = existingSet?.history ?? [];
  const nextBindingSet = {
    workspaceSlug: proposal.workspace.slug,
    workspaceId: proposal.workspace.id,
    workspaceDir: proposal.workspace.dir,
    active: proposal.kind === "unbind" ? null : binding,
    history: proposal.kind === "unbind"
      ? [binding, ...(active ? [active] : []), ...priorHistory].slice(0, 50)
      : [...(active ? [active] : []), ...priorHistory].slice(0, 50),
  };
  const nextRecord: PersonalityProposalRecord = {
    ...record,
    state: "applied",
    updatedAt: at,
    attempt: { ...record.attempt, phase: "terminal" },
    failure: null,
    hostResult: hostResult(transaction),
  };
  session.commit({
    ...nextIndexInput(session.index),
    bindings: { ...session.index.bindings, [proposal.workspace.key]: nextBindingSet },
    proposals: { ...session.index.proposals, [proposal.id]: nextRecord },
  });
  return { proposal, record: nextRecord, binding: proposal.kind === "unbind" ? null : binding };
}

function mapHostFailure(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
  record: PersonalityProposalRecord,
  error: HostPersonalityError,
  at: number,
  operation: "submit" | "inspect" | "recover" = "submit",
): never {
  const transaction = error.transaction;
  if (error.code === "FILE_CHANGED") {
    updateRecord(session, proposal.id, staleRecord(record, "file_changed", at));
    throw new AgentToolError("CONFLICT", "Personality workspace changed during apply", {
      reason: "file_changed",
    });
  }
  if (transaction?.status === "resolved_discarded") {
    updateRecord(session, proposal.id, staleRecord(record, "resolved_discarded", at, transaction));
    throw new AgentToolError("CONFLICT", "Personality recovery kept newer workspace bytes", {
      reason: "resolved_discarded",
    });
  }
  if (transaction && ["restored_failure", "recovery_required"].includes(transaction.status)) {
    updateRecord(session, proposal.id, failedRecord(record, transaction, at));
    throw new AgentToolError("EXECUTION_ERROR", "RealTimeX could not commit the Personality transaction", {
      reason: transaction.status,
      transactionId: transaction.transactionId,
    });
  }
  if (error.code === "WORKSPACE_RECOVERY_REQUIRED") {
    const blockingTransactionId = typeof error.details.transactionId === "string"
      ? error.details.transactionId
      : record.attempt?.hostTransactionId;
    if (!blockingTransactionId) {
      throw new AgentToolError("EXECUTION_ERROR", "RealTimeX workspace recovery is required", {
        reason: "host_outcome_unknown",
      });
    }
    const next: PersonalityProposalRecord = {
      ...record,
      state: "apply_failed",
      updatedAt: at,
      attempt: record.attempt ? { ...record.attempt, phase: "terminal" } : null,
      failure: {
        step: "host_recovery",
        reason: "recovery_required",
        hostRecovery: {
          transactionId: blockingTransactionId,
          status: "recovery_required",
        },
      },
      hostResult: null,
    };
    updateRecord(session, proposal.id, next);
    throw new AgentToolError("EXECUTION_ERROR", "RealTimeX workspace recovery is required", {
      reason: "recovery_required",
      transactionId: blockingTransactionId,
    });
  }
  if ([
    "PERMISSION_DENIED",
    "PERMISSION_REQUIRED",
    "APP_PERMISSION_DENIED",
    "CAPABILITY_UNSUPPORTED",
  ].includes(error.code)) {
    if (operation === "submit") {
      updateRecord(session, proposal.id, {
        ...record,
        state: "approved",
        attempt: null,
        updatedAt: at,
        failure: null,
        hostResult: null,
      });
    }
    throw new AgentToolError("CAPABILITY_UNSUPPORTED", "RealTimeX Personality permission is not granted", {
      reason: "host_capability_unavailable",
    });
  }
  if (["WORKSPACE_MISMATCH", "WORKSPACE_NOT_FOUND", "WORKSPACE_NOT_ELIGIBLE"].includes(error.code)) {
    updateRecord(session, proposal.id, staleRecord(record, "workspace_mismatch", at));
    throw new AgentToolError("CONFLICT", "RealTimeX workspace changed during apply", {
      reason: "workspace_mismatch",
    });
  }
  if (error.code === "WRITER_BUSY") {
    throw new AgentToolError("STORE_BUSY", "RealTimeX Personality writer is busy", {
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  if (error.code === "NETWORK_ERROR" || (error.status !== null && error.status >= 500)) {
    throw new AgentToolError("EXECUTION_ERROR", "RealTimeX Personality transaction outcome is pending", {
      reason: "host_outcome_unknown",
      transactionId: record.attempt?.hostTransactionId,
    });
  }
  const next: PersonalityProposalRecord = {
    ...record,
    state: "apply_failed",
    updatedAt: at,
    attempt: record.attempt ? { ...record.attempt, phase: "terminal" } : null,
    failure: { step: "host_request", reason: "proposal_corrupt" },
    hostResult: null,
  };
  updateRecord(session, proposal.id, next);
  throw new AgentToolError("EXECUTION_ERROR", "RealTimeX rejected the Personality transaction", {
    reason: "proposal_corrupt",
    hostCode: error.code,
  });
}

function dependenciesFor(input: PersonalityApplyDependencies) {
  const env = input.env ?? process.env;
  return {
    resolveWorkspace: input.resolveWorkspace
      ?? (() => resolvePersonalityWorkspace(env, input.fetchImpl ?? fetch)),
    readWorkspaceFiles: input.readWorkspaceFiles ?? readPersonalityWorkspaceFiles,
    loadSources: input.loadSources ?? loadPersonalitySourceBundle,
    probeCapability: input.probeCapability
      ?? ((uncached: boolean) => probeHostCapabilities({
        env,
        fetchImpl: input.fetchImpl ?? fetch,
        uncached,
      })),
    hostClient: input.hostClient ?? new PersonalityHostClient({
      env,
      fetchImpl: input.fetchImpl ?? fetch,
    }),
    delay: input.delay ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
  };
}

async function committedOrMismatch(input: {
  session: PersonalityStoreSession;
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
  transaction: HostPersonalityTransaction;
  client: PersonalityHostClient;
  at: number;
  onBindingCommitted?: PersonalityApplyDependencies["onBindingCommitted"];
}): Promise<PersonalityApplyResult> {
  const attempt = input.record.attempt;
  if (!attempt) {
    throw new AgentToolError("STORE_CONFLICT", "Personality attempt journal is missing", {
      reason: "store_corrupt",
    });
  }
  let exact = exactCommittedResult(
    input.proposal,
    input.transaction,
    attempt.hostTransactionId,
  );
  if (!exact && input.transaction.status === "committed") {
    const listing = await input.client.listPersonalityFiles(input.proposal.workspace);
    if (
      listing.workspace.slug !== input.proposal.workspace.slug
      || String(listing.workspace.id) !== String(input.proposal.workspace.id)
      || listing.workspace.dir !== input.proposal.workspace.dir
    ) {
      exact = false;
    } else {
      const hashes = hostListingHashes(listing);
      exact = input.proposal.files.every((file) =>
        (hashes.get(file.path) ?? null) === file.proposedFileHash);
    }
  }
  if (!exact) {
    const next: PersonalityProposalRecord = {
      ...input.record,
      state: "apply_failed",
      updatedAt: input.at,
      attempt: { ...attempt, phase: "terminal" },
      failure: { step: "host_verify", reason: "host_contract_mismatch" },
      hostResult: hostResult(input.transaction),
    };
    updateRecord(input.session, input.proposal.id, next);
    throw new AgentToolError("EXECUTION_ERROR", "RealTimeX committed an unverifiable Personality result", {
      reason: "host_contract_mismatch",
      operatorRequired: true,
    });
  }
  const committing = {
    ...input.record,
    updatedAt: input.at,
    attempt: { ...attempt, phase: "committing" as const },
    hostResult: hostResult(input.transaction),
  };
  updateRecord(input.session, input.proposal.id, committing);
  const result = successfulBinding(input.session, input.proposal, committing, input.transaction, input.at);
  await notifyBindingCommitted(
    result,
    bindingSetFor(input.session, input.proposal)?.active?.id ?? null,
    input.onBindingCommitted,
  );
  return result;
}

async function notifyBindingCommitted(
  result: PersonalityApplyResult,
  activeBindingId: string | null,
  callback: PersonalityApplyDependencies["onBindingCommitted"],
): Promise<void> {
  if (!callback) return;
  try {
    await callback(result, { activeBindingId });
  } catch (error) {
    throw new AgentToolError(
      "EXECUTION_ERROR",
      "Personality binding committed but writing cleanup must be retried",
      {
        reason: "personality_cleanup_failed",
        bindingCommitted: true,
        cleanupRequired: true,
        bindingId: activeBindingId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function preflightAndSubmit(input: {
  session: PersonalityStoreSession;
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
  dependencies: ReturnType<typeof dependenciesFor>;
  rawDependencies: PersonalityApplyDependencies;
  reuseAttempt?: Attempt;
}): Promise<PersonalityApplyResult> {
  const at = atSeconds(input.rawDependencies);
  let workspace: PersonalityWorkspace;
  let active: PersonalityBinding | null;
  try {
    workspace = await input.dependencies.resolveWorkspace();
    assertWorkspace(workspace, input.proposal);
    input.dependencies.readWorkspaceFiles(workspace);
    active = assertBaseBinding(input.session, input.proposal);
    assertProposalProvenance(input.proposal);
    assertSourceGuard(input.proposal, active, input.dependencies.loadSources);
  } catch (error) {
    if (error instanceof AgentToolError && error.code === "CONFLICT") {
      updateRecord(input.session, input.proposal.id, staleRecord(
        input.record,
        (error.details as { reason?: string } | undefined)?.reason ?? "preflight_changed",
        at,
      ));
    }
    throw error;
  }
  const capability = await input.dependencies.probeCapability(true);
  const capabilityRef = assertCapabilityLimits(input.proposal, capability);
  try {
    const listing = await input.dependencies.hostClient.listPersonalityFiles(workspace);
    assertHostListing(input.proposal, listing);
  } catch (error) {
    if (error instanceof AgentToolError && error.code === "CONFLICT") {
      updateRecord(input.session, input.proposal.id, staleRecord(
        input.record,
        (error.details as { reason?: string } | undefined)?.reason ?? "file_changed",
        at,
      ));
    } else if (error instanceof HostPersonalityError) {
      if (["PERMISSION_DENIED", "PERMISSION_REQUIRED", "APP_PERMISSION_DENIED"].includes(error.code)) {
        throw capabilityError({ ...capability, state: "not_granted" });
      }
      if (["WORKSPACE_MISMATCH", "WORKSPACE_NOT_FOUND", "WORKSPACE_NOT_ELIGIBLE"].includes(error.code)) {
        updateRecord(input.session, input.proposal.id, staleRecord(input.record, "workspace_mismatch", at));
        throw new AgentToolError("CONFLICT", "RealTimeX workspace changed during apply", {
          reason: "workspace_mismatch",
        });
      }
      throw new AgentToolError("CAPABILITY_UNSUPPORTED", "RealTimeX Personality writer is unreachable", {
        reason: "host_capability_unavailable",
      });
    }
    throw error;
  }

  let record = input.record;
  if (!input.reuseAttempt) {
    record = allocateAttempt(record, input.proposal, capabilityRef, at);
    updateRecord(input.session, input.proposal.id, record);
  } else if (input.reuseAttempt.hostCapability.version !== capabilityRef.version) {
    throw new AgentToolError("CAPABILITY_UNSUPPORTED", "RealTimeX Personality capability changed during attempt", {
      reason: "host_capability_unavailable",
    });
  }
  if (!record.attempt) {
    throw new AgentToolError("STORE_CONFLICT", "Personality attempt was not persisted", {
      reason: "store_corrupt",
    });
  }
  record = updateRecord(input.session, input.proposal.id, {
    ...record,
    updatedAt: at,
    attempt: { ...record.attempt, phase: "submitted" },
  });
  const submittedAttempt = record.attempt;
  if (!submittedAttempt) {
    throw new AgentToolError("STORE_CONFLICT", "Personality attempt journal disappeared", {
      reason: "store_corrupt",
    });
  }
  const files = input.proposal.files.map((file) => ({
    path: file.path,
    expectedFileHash: file.currentFileHash,
    proposedFile: file.proposedFile,
    proposedFileHash: file.proposedFileHash,
  }));

  let transaction: HostPersonalityTransaction;
  try {
    transaction = await input.dependencies.hostClient.putTransaction(
      workspace,
      submittedAttempt.hostTransactionId,
      files,
      input.proposal.shim.createClaudeSymlink,
    );
  } catch (error) {
    if (error instanceof HostPersonalityError && error.code === "WRITER_BUSY") {
      await input.dependencies.delay(Math.min(10, error.retryAfterSeconds ?? 2) * 1_000);
      try {
        transaction = await input.dependencies.hostClient.putTransaction(
          workspace,
          submittedAttempt.hostTransactionId,
          files,
          input.proposal.shim.createClaudeSymlink,
        );
      } catch (retryError) {
        if (retryError instanceof HostPersonalityError) {
          return mapHostFailure(input.session, input.proposal, record, retryError, at);
        }
        throw retryError;
      }
    } else if (error instanceof HostPersonalityError) {
      return mapHostFailure(input.session, input.proposal, record, error, at);
    } else {
      throw error;
    }
  }
  if (transaction.status !== "committed") {
    const error = new HostPersonalityError(
      "RealTimeX returned a non-committed transaction",
      "HOST_TRANSACTION_FAILED",
      null,
      {},
      transaction,
    );
    return mapHostFailure(input.session, input.proposal, record, error, at);
  }
  return committedOrMismatch({
    session: input.session,
    proposal: input.proposal,
    record,
    transaction,
    client: input.dependencies.hostClient,
    at,
    onBindingCommitted: input.rawDependencies.onBindingCommitted,
  });
}

async function resumeAttempt(input: {
  session: PersonalityStoreSession;
  proposal: PersonalityProposal;
  record: PersonalityProposalRecord;
  dependencies: ReturnType<typeof dependenciesFor>;
  rawDependencies: PersonalityApplyDependencies;
}): Promise<PersonalityApplyResult> {
  const attempt = input.record.attempt;
  if (!attempt) {
    return preflightAndSubmit(input);
  }
  let transaction: HostPersonalityTransaction;
  try {
    transaction = await input.dependencies.hostClient.inspectTransaction(
      input.proposal.workspace,
      attempt.hostTransactionId,
    );
  } catch (error) {
    if (error instanceof HostPersonalityError) {
      return mapHostFailure(
        input.session,
        input.proposal,
        input.record,
        error,
        atSeconds(input.rawDependencies),
        "inspect",
      );
    }
    throw error;
  }
  if (transaction.status === "committed") {
    return committedOrMismatch({
      session: input.session,
      proposal: input.proposal,
      record: input.record,
      transaction,
      client: input.dependencies.hostClient,
      at: atSeconds(input.rawDependencies),
      onBindingCommitted: input.rawDependencies.onBindingCommitted,
    });
  }
  if (transaction.status === "not_started") {
    return preflightAndSubmit({ ...input, reuseAttempt: attempt });
  }
  if (transaction.status === "resolved_discarded") {
    const record = staleRecord(
      input.record,
      "resolved_discarded",
      atSeconds(input.rawDependencies),
      transaction,
    );
    updateRecord(input.session, input.proposal.id, record);
    return { proposal: input.proposal, record, binding: null };
  }
  const record = failedRecord(input.record, transaction, atSeconds(input.rawDependencies));
  updateRecord(input.session, input.proposal.id, record);
  return { proposal: input.proposal, record, binding: null };
}

async function runApprovedProposal(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
  record: PersonalityProposalRecord,
  rawDependencies: PersonalityApplyDependencies,
): Promise<PersonalityApplyResult> {
  const dependencies = dependenciesFor(rawDependencies);
  if (record.state === "applying") {
    return resumeAttempt({ session, proposal, record, dependencies, rawDependencies });
  }
  return preflightAndSubmit({ session, proposal, record, dependencies, rawDependencies });
}

export async function approvePersonalityProposal(input: {
  proposalId: string;
  evidence: ApprovalEvidence;
}, dependencies: PersonalityApplyDependencies = {}): Promise<PersonalityApplyResult> {
  const evidence = approvalEvidenceSchema.parse(input.evidence);
  return withPersonalityStore(async (session) => {
    let record = session.index.proposals[input.proposalId];
    if (!record) throw new AgentToolError("NOT_FOUND", `Personality proposal not found: ${input.proposalId}`);
    const proposal = session.getProposal(input.proposalId);
    if (proposal.noop) {
      throw new AgentToolError("CONFLICT", "No-op Personality proposals cannot be approved", {
        reason: "proposal_noop",
      });
    }
    if (evidence.kind === "thread_message" && evidence.workspaceSlug !== proposal.workspace.slug) {
      throw new AgentToolError("VALIDATION_ERROR", "Approval evidence targets another workspace", {
        reason: "workspace_mismatch",
      });
    }
    if (record.state === "applied") {
      const result = {
        proposal,
        record,
        binding: appliedBindingFor(session, proposal),
      };
      await notifyBindingCommitted(
        result,
        bindingSetFor(session, proposal)?.active?.id ?? null,
        dependencies.onBindingCommitted,
      );
      return result;
    }
    if (record.state === "proposed") {
      const at = atSeconds(dependencies);
      record = updateRecord(session, proposal.id, {
        ...record,
        state: "approved",
        updatedAt: at,
        approval: { by: "user", at, evidence },
      });
    } else if (!record.approval || !["approved", "applying", "apply_failed"].includes(record.state)) {
      throw new AgentToolError("CONFLICT", "Personality proposal cannot be approved in its current state", {
        state: record.state,
      });
    }
    if (record.state === "apply_failed") {
      return retryWithinLock(session, proposal, record, dependencies);
    }
    return runApprovedProposal(session, proposal, record, dependencies);
  });
}

async function retryWithinLock(
  session: PersonalityStoreSession,
  proposal: PersonalityProposal,
  record: PersonalityProposalRecord,
  rawDependencies: PersonalityApplyDependencies,
): Promise<PersonalityApplyResult> {
  const dependencies = dependenciesFor(rawDependencies);
  const at = atSeconds(rawDependencies);
  if (record.state === "approved") {
    return preflightAndSubmit({ session, proposal, record, dependencies, rawDependencies });
  }
  if (record.state === "applying") {
    return resumeAttempt({ session, proposal, record, dependencies, rawDependencies });
  }
  if (record.state !== "apply_failed" || !record.attempt) {
    throw new AgentToolError("CONFLICT", "Personality proposal is not retryable", {
      state: record.state,
    });
  }
  if (
    record.hostResult?.status === "recovery_required"
    || record.failure?.hostRecovery?.status === "recovery_required"
  ) {
    const workspace = await dependencies.resolveWorkspace();
    assertWorkspace(workspace, proposal);
    assertCapabilityLimits(proposal, await dependencies.probeCapability(true));
    const recoveryTransactionId = record.failure?.hostRecovery?.transactionId
      ?? record.attempt.hostTransactionId;
    let transaction: HostPersonalityTransaction;
    try {
      transaction = await dependencies.hostClient.inspectTransaction(
        workspace,
        recoveryTransactionId,
      );
    } catch (error) {
      if (error instanceof HostPersonalityError) {
        return mapHostFailure(session, proposal, record, error, at, "inspect");
      }
      throw error;
    }
    if (transaction.status === "recovery_required") {
      try {
        transaction = await dependencies.hostClient.recoverTransaction(
          workspace,
          recoveryTransactionId,
        );
      } catch (error) {
        if (error instanceof HostPersonalityError && error.transaction) {
          transaction = error.transaction;
        } else if (error instanceof HostPersonalityError) {
          return mapHostFailure(session, proposal, record, error, at, "recover");
        } else {
          throw error;
        }
      }
    }
    if (transaction.status === "committed") {
      return committedOrMismatch({
        session,
        proposal,
        record,
        transaction,
        client: dependencies.hostClient,
        at,
        onBindingCommitted: rawDependencies.onBindingCommitted,
      });
    }
    if (transaction.status === "resolved_discarded") {
      const stale = staleRecord(record, "resolved_discarded", at, transaction);
      updateRecord(session, proposal.id, stale);
      return { proposal, record: stale, binding: null };
    }
    const failed = failedRecord(record, transaction, at);
    updateRecord(session, proposal.id, failed);
    return { proposal, record: failed, binding: null };
  }
  if (record.hostResult?.status !== "restored_failure") {
    throw new AgentToolError("CONFLICT", "Personality proposal requires a new proposal", {
      reason: record.failure?.reason ?? "not_retryable",
    });
  }
  const history = archiveAttempt(record, "restored_failure", at);
  const ready: PersonalityProposalRecord = {
    ...record,
    state: "approved",
    updatedAt: at,
    attempt: null,
    attemptHistory: history,
    failure: null,
    hostResult: null,
  };
  updateRecord(session, proposal.id, ready);
  return preflightAndSubmit({ session, proposal, record: ready, dependencies, rawDependencies });
}

export async function retryPersonalityProposal(
  proposalId: string,
  dependencies: PersonalityApplyDependencies = {},
): Promise<PersonalityApplyResult> {
  return withPersonalityStore(async (session) => {
    const record = session.index.proposals[proposalId];
    if (!record) throw new AgentToolError("NOT_FOUND", `Personality proposal not found: ${proposalId}`);
    const proposal = session.getProposal(proposalId);
    if (record.state === "applied") {
      const result = { proposal, record, binding: appliedBindingFor(session, proposal) };
      await notifyBindingCommitted(
        result,
        bindingSetFor(session, proposal)?.active?.id ?? null,
        dependencies.onBindingCommitted,
      );
      return result;
    }
    return retryWithinLock(session, proposal, record, dependencies);
  });
}
