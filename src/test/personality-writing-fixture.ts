import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createContact } from "@/lib/db/queries/contacts";
import { getLaunchById } from "@/lib/db/queries/launches";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import type { PersonalityApplyDependencies } from "@/lib/personality/apply";
import type { PersonalityProposal } from "@/lib/personality/contracts";
import type {
  HostPersonalityListing,
  HostPersonalityTransaction,
  PersonalityHostClient,
} from "@/lib/personality/host-client";
import {
  proposePersonalityProjection,
  proposePersonalityUnbind,
} from "@/lib/personality/proposal";
import { loadPersonalitySourceBundle } from "@/lib/personality/sources";
import {
  approvePersonalityProjection,
  setTargetRepresentation,
} from "@/lib/personality/use-cases";
import {
  readPersonalityWorkspaceFiles,
  type PersonalityWorkspace,
} from "@/lib/personality/workspace";
import type { PersonalityCapabilityState } from "@/lib/rtx/capabilities";
import { setRepresentedOrgId } from "@/lib/settings/signals-config";
import { buildWritingUnits } from "@/lib/writing/content-writing";
import { hardLimit } from "@/lib/writing/variant-writing";
import { sha256Canonical } from "@/lib/writing/hash";
import { materializeVariantWithRunner } from "@/lib/writing/materialize";
import {
  withPersonalityWritingGuard,
  type PersonalityGuardDependencies,
} from "@/lib/writing/personality-guard";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import {
  approveVoiceProfile,
  upsertVoiceProfile,
} from "@/lib/writing/voice-profile-store";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";

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

function listing(workspace: PersonalityWorkspace): HostPersonalityListing {
  return {
    success: true,
    workspace,
    files: readPersonalityWorkspaceFiles(workspace).flatMap((file) => file.content === null
      ? []
      : [{
          path: file.path,
          fileHash: file.fileHash!,
          size: file.size,
          content: file.content,
        }]),
    claudeShim: "missing",
    allowlist: {
      pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}\\.md$",
      excluded: ["HEARTBEAT.md", "MEMORY.md", "CLAUDE.md"],
    },
  };
}

export function materializePersonalityProposal(
  proposal: PersonalityProposal,
  workspace: PersonalityWorkspace,
): void {
  for (const file of proposal.files) {
    const path = join(workspace.dir, file.path);
    if (file.proposedFile === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      writeFileSync(path, file.proposedFile);
    }
  }
}

function transaction(
  proposal: PersonalityProposal,
  transactionId: string,
  workspace: PersonalityWorkspace,
): HostPersonalityTransaction {
  return {
    transactionId,
    status: "committed",
    origin: "sdk",
    appId: "signals-test-app",
    workspace,
    requestHash: "b".repeat(64),
    files: proposal.files.map((file) => ({
      path: file.path,
      fileHash: file.proposedFileHash,
    })),
    shim: { requested: false, created: false, state: "missing" },
    startedAt: "2026-08-31T00:00:00.000Z",
    finishedAt: "2026-08-31T00:00:01.000Z",
    replayed: false,
  };
}

export function personalityHostFor(
  proposal: PersonalityProposal,
  workspace: PersonalityWorkspace,
): PersonalityHostClient {
  return {
    listPersonalityFiles: async () => listing(workspace),
    putTransaction: async (_workspace: PersonalityWorkspace, transactionId: string) => {
      materializePersonalityProposal(proposal, workspace);
      return transaction(proposal, transactionId, workspace);
    },
    inspectTransaction: async (_workspace: PersonalityWorkspace, transactionId: string) => ({
      ...transaction(proposal, transactionId, workspace),
      status: "not_started",
      files: proposal.files.map((file) => ({ path: file.path, fileHash: file.currentFileHash })),
    }),
  } as unknown as PersonalityHostClient;
}

export function personalityWorkspace(storageDir: string): PersonalityWorkspace {
  const workingData = join(storageDir, "working-data");
  const dir = join(workingData, "signals");
  mkdirSync(dir, { recursive: true });
  const realDir = realpathSync(dir);
  return {
    slug: "signals",
    id: "workspace-test-id",
    dir: realDir,
    key: sha256Canonical(["signals", realDir]).slice(0, 32),
  };
}

export function personalityGuardDependencies(
  workspace: PersonalityWorkspace,
): PersonalityGuardDependencies {
  return {
    resolveWorkspace: async () => workspace,
    readWorkspaceFiles: readPersonalityWorkspaceFiles,
    loadSources: loadPersonalitySourceBundle,
  };
}

function voiceInput(input: {
  id: `vp_${string}`;
  ownerContactId: string;
  label: string;
  prefix: string;
}) {
  return {
    schemaVersion: 1,
    id: input.id,
    label: input.label,
    ownerContactId: input.ownerContactId,
    platforms: ["x"],
    samples: [0, 1, 2].map((index) => ({
      id: `vs_${input.prefix}${index}`,
      text: `${input.prefix} self-authored sample ${index}`,
      source: { kind: "pasted" as const, pastedAt: 30 + index },
      authorship: "self" as const,
      approved: true,
    })),
    fingerprint: {
      sentenceLength: { medianWords: 4, range: [2, 8] as [number, number] },
      openers: [],
      closers: [],
      punctuation: [],
      vocabulary: { keep: [], avoid: [] },
      formats: [],
      emoji: "none" as const,
      hashtags: "none" as const,
      protectedQuirks: [],
      taboo: [],
    },
    signatureLines: [],
    derivedBy: { method: "manual" as const, at: 30 },
  };
}

export async function installPersonalityBinding(
  workspace: PersonalityWorkspace,
  options: { voice?: boolean } = {},
) {
  setRepresentedOrgId(null);
  const self = createContact({ name: "Personality Writer", isSelf: true });
  const dependencies = personalityGuardDependencies(workspace);
  const voiceDraft = options.voice
    ? await upsertVoiceProfile(voiceInput({
        id: "vp_racevoice1",
        ownerContactId: self.id,
        label: "Race voice",
        prefix: "racevoicea",
      }))
    : null;
  const voiceProfile = voiceDraft
    ? await approveVoiceProfile({
        id: voiceDraft.profile.id,
        version: voiceDraft.profile.version,
        evidence: { kind: "ui", route: "/settings/personality" },
      })
    : null;
  const proposal = await proposePersonalityProjection(
    voiceProfile ? { voiceProfileId: voiceProfile.id } : {},
    dependencies,
  );
  const applyDependencies: PersonalityApplyDependencies = {
    ...dependencies,
    probeCapability: async () => capability,
    hostClient: personalityHostFor(proposal, workspace),
    delay: async () => {},
  };
  const applied = await approvePersonalityProjection({
    proposalId: proposal.id,
    evidence: { kind: "ui", route: "/settings/personality" },
  }, applyDependencies);
  if (!applied.binding) throw new Error("Personality binding fixture did not bind");
  return { self, proposal, binding: applied.binding, dependencies, voiceProfile };
}

export async function createReplacementVoiceDraft(input: {
  ownerContactId: string;
  label: string;
}) {
  return upsertVoiceProfile(voiceInput({
    id: "vp_racevoice2",
    ownerContactId: input.ownerContactId,
    label: input.label,
    prefix: "racevoiceb",
  }));
}

export async function approveFixturePersonalityProposal(
  proposal: PersonalityProposal,
  workspace: PersonalityWorkspace,
  dependencies: PersonalityGuardDependencies,
) {
  return approvePersonalityProjection({
    proposalId: proposal.id,
    evidence: { kind: "ui", route: "/settings/personality" },
  }, {
    ...dependencies,
    probeCapability: async () => capability,
    hostClient: personalityHostFor(proposal, workspace),
    delay: async () => {},
  });
}

export async function unbindPersonalityBinding(
  workspace: PersonalityWorkspace,
  dependencies: PersonalityGuardDependencies,
) {
  const proposal = await proposePersonalityUnbind({ kind: "tool" }, dependencies);
  const applied = await approveFixturePersonalityProposal(proposal, workspace, dependencies);
  return { proposal, applied };
}

export function personalityVariantPayload(input: {
  launchId: string;
  bindingId: string;
  targetId?: string;
  body?: string;
  surface?: "x/post" | "threads/post" | "x/reply";
  voiceProfile?: { id: string; version: number; hash: string } | null;
  /** Composed writing-intent record (#410); omitted for Platform-native fixtures. */
  intent?: Record<string, unknown>;
  /** Run the artifact is attributed to; the server resolves composition from this row. */
  workflowRunId?: string;
}) {
  const body = input.body ?? "Personality-bound publish proof.";
  const launch = getLaunchById(input.launchId)!;
  const spine = JSON.parse(launch.metadata ?? "{}").writing.spine;
  const surface = input.surface ?? "x/post";
  const platform = surface.startsWith("x/") ? "x" : "threads";
  return {
    launchId: input.launchId,
    generationMetadata: {
      schemaVersion: 1,
      kind: "signals-writing",
      mode: "draft",
      model: "test-model",
      skill: { name: "signals-writing", version: "1.1.0" },
      agent: { workflowRunId: input.workflowRunId ?? "run-personality-proof" },
      requestHash: `request-${surface}-${body}`,
      generatedAt: 20,
    },
    metadata: {
      writing: {
        schemaVersion: 1,
        platform,
        surface,
        ...(input.targetId ? { targetId: input.targetId } : {}),
        goal: "likes",
        formulaId: `${surface}/test@1`,
        overlay: { id: `overlay:${platform}`, version: 1 },
        core: { version: 1 },
        voiceProfile: input.voiceProfile ?? null,
        voicePrecedence: "voice_first",
        spine: { id: spine.id, hash: spine.hash },
        units: buildWritingUnits([body]),
        claimMap: [{ claimId: "clm_personality1", present: true, unit: 0 }],
        audit: {
          schemaVersion: 1,
          auditedAt: 20,
          auditor: { kind: "agent", skillVersion: "1.1.0" },
          overlay: { id: `overlay:${platform}`, version: 1 },
          core: { version: 1 },
          verdict: "pass",
          findings: [],
          claims: {
            total: 1,
            preserved: 1,
            altered: [],
            missing: [],
            invented: [],
            privateIncluded: [],
          },
          hard: {
            units: 1,
            chars: [body.length],
            limit: hardLimit(surface),
            hashtags: 0,
            links: 0,
            mediaCount: 0,
          },
          voice: input.voiceProfile
            ? {
                status: "applied",
                profileId: input.voiceProfile.id,
                version: input.voiceProfile.version,
                skipped: [],
              }
            : { status: "none", skipped: [] },
          heuristics: { applied: [], conflicts: [], skippedForVoice: [] },
        },
        lineage: { sourceIds: ["src_personality1"] },
        personality: { bindingId: input.bindingId },
        ...(input.intent ? { intent: input.intent } : {}),
      },
    },
  };
}

export async function createPersonalityWritingFixture(
  storageDir: string,
  options: { voice?: boolean } = {},
) {
  const workspace = personalityWorkspace(storageDir);
  const authority = await installPersonalityBinding(workspace, options);
  const connection = ensureBrowserConnection({ sessionName: "personality-writing-proof" });
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform: "x",
    kind: "account",
    name: "Personality target",
    handle: "@personality",
    capabilities: ["publish"],
    source: "test",
  });
  await setTargetRepresentation({
    targetId: target.id,
    bindingId: authority.binding.id,
    represents: { kind: "self", contactId: authority.self.id },
    evidence: { kind: "ui", route: "/settings/personality" },
  }, authority.dependencies);
  const created = await invokeAgentTool("upsert_launch", {
    name: "Personality publish proof",
    metadata: {
      writing: {
        schemaVersion: 1,
        goal: "likes",
        surfaces: [{ platform: "x", surface: "x/post", targetId: target.id }],
        sources: [{
          id: "src_personality1",
          kind: "note",
          text: "Personality-bound publish proof.",
          enteredAt: 10,
          sensitivity: { level: "public", reason: "public_default" },
        }],
        spine: {
          schemaVersion: 1,
          id: "spn_personality1",
          launchId: "placeholder",
          goal: "likes",
          audience: { nicheIds: [] },
          sources: [{
            id: "src_personality1",
            kind: "note",
            text: "Personality-bound publish proof.",
            enteredAt: 10,
            sensitivity: { level: "public", reason: "public_default" },
          }],
          claims: [{
            id: "clm_personality1",
            kind: "fact",
            text: "Personality-bound publish proof.",
            sourceId: "src_personality1",
            verbatimRequired: false,
            sensitivity: "public",
            includeInOutput: true,
          }],
          message: {
            core: "Personality-bound publish proof.",
            supporting: [],
            proofClaimIds: ["clm_personality1"],
          },
          extractedBy: { at: 10 },
          hash: "server-replaces-this",
        },
        voiceProfile: null,
        voicePrecedence: "voice_first",
        approvalPolicy: "auto_low_risk",
        runs: [{ workflowRunId: "run-personality-proof", mode: "draft", startedAt: 10 }],
      },
    },
  }) as { id: string };
  const variant = await upsertVariantUseCase(personalityVariantPayload({
    launchId: created.id,
    bindingId: authority.binding.id,
    targetId: target.id,
    voiceProfile: authority.voiceProfile,
  }), authority.dependencies);
  const materialized = await withPersonalityWritingGuard(
    (guard, tx) => materializeVariantWithRunner({ variantId: variant.id }, guard, tx),
    authority.dependencies,
  );
  if ("gateError" in materialized && materialized.gateError) {
    throw new Error(materialized.gateError.message);
  }
  return {
    workspace,
    ...authority,
    connection,
    target,
    launchId: created.id,
    variantId: variant.id,
    contentItemId: materialized.contentItemId,
  };
}
