import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/db/client";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { getContentItem } from "@/lib/db/queries/content";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  commitIndex as commitStoreIndex,
  installImmutable as installImmutableJson,
  withStoreLock,
} from "@/lib/store/locked-json-store";
import {
  type ApprovalEvidence,
  type VoiceProfile,
  type VoiceProfileVersionDocument,
  approvalEvidenceSchema,
  voiceProfileInputSchema,
  voiceProfileVersionDocumentSchema,
} from "@/lib/writing/contracts";
import { computeVoiceProfileHash, sha256, sha256Canonical } from "@/lib/writing/hash";
import { newWritingId } from "@/lib/writing/ids";

type VersionIndex = {
  hash: string;
  state: "draft" | "approved" | "superseded" | "rejected";
  approval?: { by: "user"; at: number; evidence: ApprovalEvidence };
  supersededBy?: { id: string; version: number };
};

type VoiceProfileIndex = {
  schemaVersion: 1;
  generation: number;
  profiles: Record<string, {
    ownerContactId: string | null;
    label: string;
    latestVersion: number;
    versions: Record<string, VersionIndex>;
  }>;
  activeByOwnerLabel: Record<string, { id: string; version: number; hash: string }>;
  updatedAt: number;
};

const EMPTY_INDEX: VoiceProfileIndex = {
  schemaVersion: 1,
  generation: 0,
  profiles: {},
  activeByOwnerLabel: {},
  updatedAt: 0,
};
export const __voiceStoreTestHooks: {
  beforeInstall?: (path: string) => void;
  afterInstall?: (path: string) => void;
  beforeIndexCommit?: (path: string) => void;
} = {};

function storeDir(): string {
  const dir = join(dataDir, "writing", "voice-profiles");
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function indexPath(): string {
  return join(storeDir(), "index.json");
}

function readIndex(): VoiceProfileIndex {
  const path = indexPath();
  if (!existsSync(path)) return structuredClone(EMPTY_INDEX);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as VoiceProfileIndex;
    if (parsed.schemaVersion !== 1 || !Number.isInteger(parsed.generation)) throw new Error();
    return parsed;
  } catch {
    throw new AgentToolError("STORE_CONFLICT", "Voice profile index is invalid");
  }
}

function ownerLabelKey(ownerContactId: string | null, label: string): string {
  return sha256Canonical([ownerContactId, label]);
}

export async function withVoiceProfileStoreLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const dir = storeDir();
  return withStoreLock(dir, dir, operation, { busyMessage: "Voice profile store is busy" });
}

function installImmutable(path: string, value: unknown): void {
  installImmutableJson(path, value, {
    beforeWrite: __voiceStoreTestHooks.beforeInstall,
    afterWrite: __voiceStoreTestHooks.afterInstall,
  });
}

function commitIndex(base: VoiceProfileIndex, next: VoiceProfileIndex): void {
  commitStoreIndex(readIndex, base, next, {
    path: indexPath(),
    conflictMessage: "Voice profile index changed during commit",
    beforeWrite: __voiceStoreTestHooks.beforeIndexCommit,
  });
}

function readDocument(id: string, version: number): VoiceProfileVersionDocument {
  const path = join(storeDir(), id, `v${version}.json`);
  if (!existsSync(path)) throw new AgentToolError("NOT_FOUND", `Voice profile version not found: ${id} v${version}`);
  const result = voiceProfileVersionDocumentSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!result.success) throw new AgentToolError("STORE_CONFLICT", `Voice profile version is invalid: ${id} v${version}`);
  return result.data;
}

function projectProfile(index: VoiceProfileIndex, id: string, version: number): VoiceProfile {
  const profile = index.profiles[id];
  const lifecycle = profile?.versions[String(version)];
  if (!profile || !lifecycle) throw new AgentToolError("NOT_FOUND", `Voice profile not found: ${id} v${version}`);
  const doc = readDocument(id, version);
  return {
    ...doc,
    status: lifecycle.state,
    ...(lifecycle.approval ? { approval: lifecycle.approval } : {}),
    ...(lifecycle.supersededBy ? { supersededBy: lifecycle.supersededBy } : {}),
  };
}

function normalizedProfileInput(value: unknown): Record<string, unknown> {
  const raw = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
  for (const field of ["version", "hash", "status", "approval", "supersededBy"]) delete raw[field];
  const parsed = voiceProfileInputSchema.safeParse(raw);
  if (!parsed.success) throw new AgentToolError("VALIDATION_ERROR", "Invalid voice profile", parsed.error.flatten());
  const id = parsed.data.id ?? newWritingId("vp");
  const ownerContactId = parsed.data.ownerContactId ?? getOwnerContactId();
  const samples = parsed.data.samples.map((sample) => {
    if (sample.source.kind === "pasted") return { ...sample, source: { ...sample.source, sha256: sha256(sample.text) } };
    if (sample.source.kind === "file") {
      let bytes: Buffer;
      try { bytes = readFileSync(sample.source.path); } catch { throw new AgentToolError("VALIDATION_ERROR", `Voice sample file cannot be read: ${sample.source.path}`); }
      return { ...sample, source: { ...sample.source, sha256: sha256(bytes) } };
    }
    const item = getContentItem(sample.source.contentItemId);
    if (!item) throw new AgentToolError("NOT_FOUND", `Content item not found: ${sample.source.contentItemId}`);
    return { ...sample, source: { ...sample.source, sha256: sha256(item.body ?? "") } };
  });
  return { ...parsed.data, id, ownerContactId, samples };
}

function upsertVoiceProfileOnce(input: Record<string, unknown>): { profile: VoiceProfile; created: boolean } {
    const id = input.id as string;
    const hash = computeVoiceProfileHash(input);
    const base = readIndex();
    const existing = base.profiles[id];
    if (existing) {
      const matchingVersion = Object.entries(existing.versions)
        .find(([, candidate]) => candidate.hash === hash)?.[0];
      if (matchingVersion) return { profile: projectProfile(base, id, Number(matchingVersion)), created: false };
    }
    let version = (existing?.latestVersion ?? 0) + 1;
    let doc: VoiceProfileVersionDocument;
    while (true) {
      doc = voiceProfileVersionDocumentSchema.parse({ ...input, version, hash });
      const path = join(storeDir(), id, `v${version}.json`);
      if (!existsSync(path)) { installImmutable(path, doc); break; }
      try {
        const orphan = voiceProfileVersionDocumentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        if (orphan.id === id && orphan.version === version && orphan.hash === hash) break;
      } catch {
        // Preserve invalid or mismatched orphan and advance.
      }
      version += 1;
    }
    const now = Math.floor(Date.now() / 1000);
    const next = structuredClone(base);
    next.generation = base.generation + 1;
    next.updatedAt = now;
    next.profiles[id] = {
      ownerContactId: input.ownerContactId as string | null,
      label: input.label as string,
      latestVersion: version,
      versions: { ...(existing?.versions ?? {}), [String(version)]: { hash, state: "draft" } },
    };
    commitIndex(base, next);
    return { profile: projectProfile(next, id, version), created: true };
}

export async function upsertVoiceProfile(value: unknown): Promise<{ profile: VoiceProfile; created: boolean }> {
  const input = normalizedProfileInput(value);
  return withVoiceProfileStoreLock(() => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return upsertVoiceProfileOnce(input);
      } catch (error) {
        if (!(error instanceof AgentToolError) || error.code !== "STORE_CONFLICT" || attempt === 2) throw error;
      }
    }
    throw new AgentToolError("STORE_CONFLICT", "Voice profile store remained conflicted after 3 attempts");
  });
}

function assertAdmissible(profile: VoiceProfileVersionDocument): void {
  const admissible = profile.samples.filter((sample) => sample.approved && !sample.excludedReason);
  if (admissible.length < 3) throw new AgentToolError("VALIDATION_ERROR", "Approval requires at least 3 admissible approved samples", { reason: "voice_samples_insufficient" });
  const samples = new Map(profile.samples.map((sample) => [sample.id, sample]));
  for (const sample of admissible) {
    if (sample.authorship !== "self") throw new AgentToolError("VALIDATION_ERROR", "Voice samples must be self-authored", { reason: "voice_sample_not_self" });
    if (sample.source.kind === "content_item") {
      const item = getContentItem(sample.source.contentItemId);
      if (!item || item.aiGenerated || item.direction !== "outbound" || (item.origin !== "authored" && item.origin !== "imported")) {
        throw new AgentToolError("VALIDATION_ERROR", "Content voice sample is not admissible", { reason: "voice_sample_content_invalid", sampleId: sample.id });
      }
    }
  }
  for (const signature of profile.signatureLines) {
    const sample = samples.get(signature.sampleId);
    if (!sample || !sample.text.includes(signature.text)) throw new AgentToolError("VALIDATION_ERROR", "Signature line must be verbatim from its sample", { reason: "signature_not_verbatim", sampleId: signature.sampleId });
  }
}

export async function approveVoiceProfile(input: { id: string; version: number; evidence: ApprovalEvidence }): Promise<VoiceProfile> {
  const evidence = approvalEvidenceSchema.parse(input.evidence);
  return withVoiceProfileStoreLock(() => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return approveVoiceProfileOnce(input.id, input.version, evidence);
      } catch (error) {
        if (!(error instanceof AgentToolError) || error.code !== "STORE_CONFLICT" || attempt === 2) throw error;
      }
    }
    throw new AgentToolError("STORE_CONFLICT", "Voice profile store remained conflicted after 3 attempts");
  });
}

function approveVoiceProfileOnce(id: string, version: number, evidence: ApprovalEvidence): VoiceProfile {
    const base = readIndex();
    const entry = base.profiles[id];
    if (!entry) throw new AgentToolError("NOT_FOUND", `Voice profile not found: ${id}`);
    if (entry.latestVersion !== version || entry.versions[String(version)]?.state !== "draft") {
      throw new AgentToolError("CONFLICT", "Only the latest draft voice profile can be approved");
    }
    const doc = readDocument(id, version);
    assertAdmissible(doc);
    const next = structuredClone(base);
    const now = Math.floor(Date.now() / 1000);
    const key = ownerLabelKey(doc.ownerContactId, doc.label);
    const previous = next.activeByOwnerLabel[key];
    if (previous && (previous.id !== id || previous.version !== version)) {
      const previousState = next.profiles[previous.id]?.versions[String(previous.version)];
      if (previousState) {
        previousState.state = "superseded";
        previousState.supersededBy = { id, version };
      }
    }
    const state = next.profiles[id].versions[String(version)];
    state.state = "approved";
    state.approval = { by: "user", at: now, evidence };
    next.activeByOwnerLabel[key] = { id, version, hash: doc.hash };
    next.generation += 1;
    next.updatedAt = now;
    commitIndex(base, next);
    return projectProfile(next, id, version);
}

export function getVoiceProfile(id: string, version?: number): { profile: VoiceProfile; active: { version: number } | null } {
  const index = readIndex();
  const entry = index.profiles[id];
  if (!entry) throw new AgentToolError("NOT_FOUND", `Voice profile not found: ${id}`);
  const resolvedVersion = version ?? entry.latestVersion;
  const profile = projectProfile(index, id, resolvedVersion);
  const active = index.activeByOwnerLabel[ownerLabelKey(profile.ownerContactId, profile.label)];
  return { profile, active: active ? { version: active.version } : null };
}

export function listVoiceProfiles(status?: VoiceProfile["status"]): VoiceProfile[] {
  const index = readIndex();
  const result: VoiceProfile[] = [];
  for (const [id, entry] of Object.entries(index.profiles)) {
    for (const version of Object.keys(entry.versions).map(Number).sort((a, b) => b - a)) {
      const profile = projectProfile(index, id, version);
      if (!status || profile.status === status) result.push(profile);
    }
  }
  return result;
}

export function getActiveVoiceProfileFor(input: { ownerContactId?: string | null; label?: string } = {}): VoiceProfile | null {
  const index = readIndex();
  const all = Object.values(index.activeByOwnerLabel)
    .map((candidate) => projectProfile(index, candidate.id, candidate.version))
    .filter((profile) => profile.status === "approved")
    .sort((a, b) => (b.approval?.at ?? 0) - (a.approval?.at ?? 0));
  const ownerContactId = input.ownerContactId === undefined ? getOwnerContactId() : input.ownerContactId;
  return all.find((profile) =>
    profile.ownerContactId === ownerContactId && (!input.label || profile.label === input.label)
  ) ?? all.find((profile) => !input.label || profile.label === input.label) ?? null;
}

export function getActiveVoiceProfile(ownerContactId = getOwnerContactId()): VoiceProfile | null {
  return getActiveVoiceProfileFor({ ownerContactId });
}

export function resolveActiveVoiceProfileContext(ownerContactId = getOwnerContactId()) {
  const profiles = listVoiceProfiles("approved")
    .sort((a, b) => (b.approval?.at ?? 0) - (a.approval?.at ?? 0));
  const preferred = profiles.filter((profile) => profile.ownerContactId === ownerContactId);
  const pool = preferred.length ? preferred : profiles;
  return {
    profile: pool[0] ?? null,
    candidates: pool.map((profile) => ({ id: profile.id, version: profile.version, hash: profile.hash, label: profile.label })),
    ambiguous: pool.length > 1,
  };
}

export function resolveVoiceProfile(ref: { id: string; version: number; hash: string }): VoiceProfile {
  const { profile } = getVoiceProfile(ref.id, ref.version);
  if (profile.hash !== ref.hash) throw new AgentToolError("VALIDATION_ERROR", "Voice profile hash mismatch", { reason: "voice_profile_hash_mismatch" });
  if (profile.status !== "approved" && profile.status !== "superseded") throw new AgentToolError("VALIDATION_ERROR", "Voice profile is not approved", { reason: "voice_profile_not_approved" });
  return profile;
}

export const resolveVoiceProfileRef = resolveVoiceProfile;

export function resetWritingStore(): void {
  const root = join(dataDir, "writing", "voice-profiles");
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  delete __voiceStoreTestHooks.beforeInstall;
  delete __voiceStoreTestHooks.afterInstall;
  delete __voiceStoreTestHooks.beforeIndexCommit;
}
