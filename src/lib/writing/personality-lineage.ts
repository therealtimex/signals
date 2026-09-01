import { z } from "zod";
import { canonicalJson } from "@/lib/writing/hash";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bindingIdSchema = z.string().regex(/^pb_[A-Za-z0-9_-]{6,}$/);

export const PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION = "1.1.0";

export const targetRepresentationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unbound") }).strict(),
  z.object({ kind: z.literal("self"), contactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("org"), orgId: z.string().min(1) }).strict(),
]);

export const variantPersonalityInputSchema = z.object({
  bindingId: bindingIdSchema,
}).strict();

export const variantPersonalitySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  bindingId: bindingIdSchema,
  personalityHash: hashSchema,
  bindingSourceHash: hashSchema,
  workspaceSlug: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  workspaceKey: z.string().min(1),
  identity: z.object({
    selfContactId: z.string().min(1),
    representedOrgId: z.string().min(1).nullable(),
  }).strict(),
  target: z.object({
    targetId: z.string().min(1),
    represents: targetRepresentationSchema,
  }).strict().nullable(),
}).strict();

export const writingAuditPersonalitySchema = variantPersonalitySnapshotSchema.extend({
  currentSourceHash: hashSchema,
  statusAtAudit: z.enum(["bound", "source_stale"]),
}).strict();

export type TargetRepresentation = z.infer<typeof targetRepresentationSchema>;
export type VariantPersonalityInput = z.infer<typeof variantPersonalityInputSchema>;
export type VariantPersonalitySnapshot = z.infer<typeof variantPersonalitySnapshotSchema>;
export type WritingAuditPersonality = z.infer<typeof writingAuditPersonalitySchema>;

type ParsedSemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function isPersonalityAwareWritingSkillVersion(version: string): boolean {
  const candidate = parseSemanticVersion(version);
  const minimum = parseSemanticVersion(PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION)!;
  if (!candidate) return false;
  for (const key of ["major", "minor", "patch"] as const) {
    if (candidate[key] !== minimum[key]) return candidate[key] > minimum[key];
  }
  return candidate.prerelease === null;
}

export function personalitySnapshotsEqual(
  left: VariantPersonalitySnapshot | null | undefined,
  right: VariantPersonalitySnapshot | null | undefined,
): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

export function auditPersonalityMatchesSnapshot(
  snapshot: VariantPersonalitySnapshot,
  audit: WritingAuditPersonality | null | undefined,
): boolean {
  if (!audit) return false;
  const {
    currentSourceHash: _currentSourceHash,
    statusAtAudit: _statusAtAudit,
    ...auditSnapshot
  } = audit;
  return personalitySnapshotsEqual(snapshot, auditSnapshot);
}

export const PERSONALITY_SOURCE_STALE_FINDING_CODE = "core/voice/personality-source-stale";

export function personalitySourceStaleFinding(input: {
  bindingSourceHash: string;
  currentSourceHash: string;
}) {
  return {
    code: PERSONALITY_SOURCE_STALE_FINDING_CODE,
    class: "voice" as const,
    severity: "warning" as const,
    message:
      "Personality sources changed after the active workspace Personality was applied; "
      + "this audit retains unchanged Personality bytes and requires fresh explicit approval.",
    evidence: `bindingSourceHash=${input.bindingSourceHash};currentSourceHash=${input.currentSourceHash}`,
    sourceRef: "specs/personality-projection.md#63-stale-sources",
  };
}

export function hasExactPersonalitySourceStaleFinding(
  findings: unknown,
  input: { bindingSourceHash: string; currentSourceHash: string },
): boolean {
  const matches = (Array.isArray(findings) ? findings : []).filter((finding) =>
    finding !== null
    && typeof finding === "object"
    && "code" in finding
    && finding.code === PERSONALITY_SOURCE_STALE_FINDING_CODE);
  return matches.length === 1
    && canonicalJson(matches[0]) === canonicalJson(personalitySourceStaleFinding(input));
}
