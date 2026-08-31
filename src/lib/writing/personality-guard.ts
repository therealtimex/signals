import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import { db, type DbRunner } from "@/lib/db/client";
import { platformTargets } from "@/lib/db/schema";
import type { PlatformTarget } from "@/lib/db/types";
import type { PersonalityBinding, PersonalityStatus } from "@/lib/personality/contracts";
import {
  computePersonalityStatus,
  type PersonalityStatusCoreInput,
} from "@/lib/personality/status";
import {
  projectTargetRepresentation,
  type TargetPersonalityDecision,
} from "@/lib/personality/target-representation";
import { loadPersonalitySourceBundle } from "@/lib/personality/sources";
import { withPersonalityStore } from "@/lib/personality/store";
import {
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspace,
  type PersonalityWorkspace,
} from "@/lib/personality/workspace";
import type { EnvLike } from "@/lib/rtx/env";
import {
  type TargetRepresentation,
  type VariantPersonalitySnapshot,
  type WritingAuditPersonality,
  auditPersonalityMatchesSnapshot,
  hasExactPersonalitySourceStaleFinding,
  personalitySnapshotsEqual,
  variantPersonalitySnapshotSchema,
  writingAuditPersonalitySchema,
} from "@/lib/writing/personality-lineage";
import { withVoiceProfileStoreLock } from "@/lib/writing/voice-profile-store";

export type PersonalityWritingGuard = {
  workspace: PersonalityWorkspace;
  binding: PersonalityBinding | null;
  status: PersonalityStatus["status"];
  currentPersonalityHash: string | null;
  currentSourceHash: string | null;
  currentIdentity: PersonalityBinding["identity"] | null;
  compatibleTargets: Set<string>;
  targetDecisions: Map<string, TargetPersonalityDecision | null>;
  targets: Map<string, PlatformTarget>;
  detail: PersonalityStatus["detail"];
};

export type PersonalityGuardDependencies = {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  resolveWorkspace?: () => Promise<PersonalityWorkspace>;
  readWorkspaceFiles?: typeof readPersonalityWorkspaceFiles;
  loadSources?: typeof loadPersonalitySourceBundle;
};

function guardError(
  code: "CONFLICT" | "WORKSPACE_UNAVAILABLE" | "AUDIT_STALE",
  message: string,
  reason: string,
): never {
  throw new AgentToolError(code, message, { reason });
}

function currentIdentity(
  loadSources: typeof loadPersonalitySourceBundle,
): PersonalityBinding["identity"] | null {
  try {
    const bundle = loadSources();
    return {
      selfContactId: bundle.sources.identity.contactId,
      representedOrgId: bundle.sources.brand?.orgId ?? null,
    };
  } catch {
    return null;
  }
}

function buildGuard(input: {
  workspace: PersonalityWorkspace;
  index: Parameters<typeof computePersonalityStatus>[0]["index"];
  getProposal: PersonalityStatusCoreInput["getProposal"];
  readFiles: typeof readPersonalityWorkspaceFiles;
  loadSources: typeof loadPersonalitySourceBundle;
  targets: PlatformTarget[];
}): PersonalityWritingGuard {
  const status = computePersonalityStatus({
    workspace: input.workspace,
    index: input.index,
    getProposal: input.getProposal,
    readFiles: input.readFiles,
    loadSources: input.loadSources,
    targets: input.targets,
    host: { capability: "available", version: null },
  });
  const bindingSet = input.index.bindings[input.workspace.key];
  const binding = bindingSet
    && bindingSet.workspaceSlug === input.workspace.slug
    && bindingSet.workspaceId === input.workspace.id
    && bindingSet.workspaceDir === input.workspace.dir
    ? bindingSet.active
    : null;
  return {
    workspace: input.workspace,
    binding,
    status: status.status,
    currentPersonalityHash:
      status.status === "bound" || status.status === "source_stale"
        ? binding?.personalityHash ?? null
        : null,
    currentSourceHash: status.currentSourceHash,
    currentIdentity: currentIdentity(input.loadSources),
    compatibleTargets: new Set(status.compatibleTargets),
    targetDecisions: new Map(input.targets.map((target) => [
      target.id,
      projectTargetRepresentation(target).personalityDecision,
    ])),
    targets: new Map(input.targets.map((target) => [target.id, target])),
    detail: status.detail,
  };
}

export async function withPersonalityWritingGuard<T>(
  operation: (guard: PersonalityWritingGuard, tx: DbRunner) => T,
  dependencies: PersonalityGuardDependencies = {},
): Promise<T> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const workspace = await (
    dependencies.resolveWorkspace?.()
    ?? resolvePersonalityWorkspace(env, fetchImpl)
  );
  const readFiles = dependencies.readWorkspaceFiles ?? readPersonalityWorkspaceFiles;
  const rawLoadSources = dependencies.loadSources ?? loadPersonalitySourceBundle;
  return withPersonalityStore((session) => withVoiceProfileStoreLock(() =>
    db.transaction((tx) => {
      let cachedSources: ReturnType<typeof rawLoadSources> | undefined;
      const loadSources: typeof rawLoadSources = (options) => {
        if (options?.voiceProfileId) return rawLoadSources(options);
        cachedSources ??= rawLoadSources();
        return cachedSources;
      };
      const targets = tx.select().from(platformTargets).all();
      const guard = buildGuard({
        workspace,
        index: session.index,
        getProposal: (proposalId) => session.getProposal(proposalId),
        readFiles,
        loadSources,
        targets,
      });
      return operation(guard, tx);
    }, { behavior: "immediate" }),
  ));
}

function assertUsableBinding(
  guard: PersonalityWritingGuard,
  bindingId: string,
): PersonalityBinding {
  if (guard.status === "unavailable") {
    return guardError(
      "WORKSPACE_UNAVAILABLE",
      "Personality workspace is unavailable",
      guard.detail?.unavailable === "workspace_mismatch"
        ? "workspace_mismatch"
        : "personality_workspace_unavailable",
    );
  }
  if (!guard.binding || guard.binding.id !== bindingId) {
    return guardError("CONFLICT", "Personality binding is no longer active", "personality_binding_stale");
  }
  if (guard.status === "drifted" || !guard.currentPersonalityHash) {
    return guardError("CONFLICT", "Personality files have drifted", "personality_drifted");
  }
  if (!guard.currentIdentity) {
    return guardError("CONFLICT", "Personality represented identity changed", "personality_identity_mismatch");
  }
  if (
    guard.currentIdentity.selfContactId !== guard.binding.identity.selfContactId
    || guard.currentIdentity.representedOrgId !== guard.binding.identity.representedOrgId
  ) {
    return guardError("CONFLICT", "Personality represented identity changed", "personality_identity_mismatch");
  }
  return guard.binding;
}

export function stampVariantPersonality(input: {
  guard: PersonalityWritingGuard;
  bindingId: string;
  targetId?: string;
  requireCompatibleTarget?: boolean;
}): VariantPersonalitySnapshot {
  const binding = assertUsableBinding(input.guard, input.bindingId);
  let target: VariantPersonalitySnapshot["target"] = null;
  if (input.targetId) {
    const targetRow = input.guard.targets.get(input.targetId);
    if (!targetRow || targetRow.status !== "active") {
      return guardError("CONFLICT", "Personality target is unavailable", "target_identity_mismatch");
    }
    const represents = projectTargetRepresentation(targetRow).represents;
    if (input.requireCompatibleTarget && !input.guard.compatibleTargets.has(input.targetId)) {
      return guardError("CONFLICT", "Target does not represent the active Personality", "target_identity_mismatch");
    }
    target = { targetId: input.targetId, represents };
  }
  return variantPersonalitySnapshotSchema.parse({
    schemaVersion: 1,
    bindingId: binding.id,
    personalityHash: input.guard.currentPersonalityHash,
    bindingSourceHash: binding.sourceHash,
    workspaceSlug: binding.workspace.slug,
    workspaceId: binding.workspace.id,
    workspaceKey: binding.workspace.key,
    identity: binding.identity,
    target,
  });
}

export function stampAuditPersonality(
  snapshot: VariantPersonalitySnapshot,
  guard: PersonalityWritingGuard,
): WritingAuditPersonality {
  assertUsableBinding(guard, snapshot.bindingId);
  if (!guard.currentSourceHash) {
    return guardError("AUDIT_STALE", "Personality source state is unavailable", "personality_source_stale");
  }
  return writingAuditPersonalitySchema.parse({
    ...snapshot,
    currentSourceHash: guard.currentSourceHash,
    statusAtAudit: guard.status === "source_stale" ? "source_stale" : "bound",
  });
}

export type PersonalityGateFailure = {
  reason:
    | "personality_binding_stale"
    | "personality_workspace_unavailable"
    | "workspace_mismatch"
    | "personality_drifted"
    | "personality_identity_mismatch"
    | "personality_source_stale"
    | "target_identity_mismatch";
  revokedReason: "personality_stale" | "personality_source_stale";
};

export function personalityGateFailure(input: {
  snapshot: VariantPersonalitySnapshot;
  audit: WritingAuditPersonality | null | undefined;
  auditFindings?: readonly unknown[];
  guard: PersonalityWritingGuard;
  requireCompatibleTarget?: boolean;
}): PersonalityGateFailure | null {
  const { snapshot, audit, guard } = input;
  if (guard.status === "unavailable") {
    return {
      reason: guard.detail?.unavailable === "workspace_mismatch"
        ? "workspace_mismatch"
        : "personality_workspace_unavailable",
      revokedReason: "personality_stale",
    };
  }
  if (!guard.binding || guard.binding.id !== snapshot.bindingId) {
    return { reason: "personality_binding_stale", revokedReason: "personality_stale" };
  }
  if (guard.binding.sourceHash !== snapshot.bindingSourceHash) {
    return { reason: "personality_source_stale", revokedReason: "personality_source_stale" };
  }
  if (guard.status === "drifted" || guard.currentPersonalityHash !== snapshot.personalityHash) {
    return { reason: "personality_drifted", revokedReason: "personality_stale" };
  }
  if (
    guard.workspace.slug !== snapshot.workspaceSlug
    || guard.workspace.id !== snapshot.workspaceId
    || guard.workspace.key !== snapshot.workspaceKey
  ) {
    return { reason: "workspace_mismatch", revokedReason: "personality_stale" };
  }
  if (
    !guard.currentIdentity
    || guard.currentIdentity.selfContactId !== snapshot.identity.selfContactId
    || guard.currentIdentity.representedOrgId !== snapshot.identity.representedOrgId
  ) {
    return { reason: "personality_identity_mismatch", revokedReason: "personality_stale" };
  }
  if (input.requireCompatibleTarget && !snapshot.target) {
    return { reason: "target_identity_mismatch", revokedReason: "personality_stale" };
  }
  if (snapshot.target) {
    const target = guard.targets.get(snapshot.target.targetId);
    const currentRepresentation = target
      ? projectTargetRepresentation(target).represents
      : ({ kind: "unbound" } as TargetRepresentation);
    if (
      !target
      || target.status !== "active"
      || !personalitySnapshotsEqual(
        { ...snapshot, target: snapshot.target },
        { ...snapshot, target: { ...snapshot.target, represents: currentRepresentation } },
      )
      || (input.requireCompatibleTarget && !guard.compatibleTargets.has(snapshot.target.targetId))
    ) {
      return { reason: "target_identity_mismatch", revokedReason: "personality_stale" };
    }
  }
  if (audit && !auditPersonalityMatchesSnapshot(snapshot, audit)) {
    return { reason: "personality_drifted", revokedReason: "personality_stale" };
  }
  if (
    guard.status === "source_stale"
    && guard.currentSourceHash
    && !hasExactPersonalitySourceStaleFinding(input.auditFindings ?? [], {
      bindingSourceHash: snapshot.bindingSourceHash,
      currentSourceHash: guard.currentSourceHash,
    })
  ) {
    return { reason: "personality_source_stale", revokedReason: "personality_source_stale" };
  }
  if (
    !audit
    || audit.bindingId !== snapshot.bindingId
    || audit.personalityHash !== snapshot.personalityHash
    || audit.currentSourceHash !== guard.currentSourceHash
    || audit.statusAtAudit !== (guard.status === "source_stale" ? "source_stale" : "bound")
  ) {
    return { reason: "personality_source_stale", revokedReason: "personality_source_stale" };
  }
  return null;
}

export function loadTargetWithRunner(tx: DbRunner, targetId: string): PlatformTarget | undefined {
  return tx.select().from(platformTargets).where(eq(platformTargets.id, targetId)).get();
}
