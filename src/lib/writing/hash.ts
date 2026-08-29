import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Canonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function computeAuditInputHash(
  body: string | null | undefined,
  writing: Record<string, unknown>,
): string {
  const fields = [
    "platform",
    "surface",
    "targetId",
    "goal",
    "formulaId",
    "overlay",
    "core",
    "voiceProfile",
    "voicePrecedence",
    "spine",
    "units",
    "claimMap",
  ];
  return sha256Canonical({
    body: body ?? null,
    ...Object.fromEntries(fields.map((key) => [key, writing[key]])),
  });
}

export function computeSpineHash(spine: Record<string, unknown>): string {
  return sha256Canonical({ sources: spine.sources, claims: spine.claims, message: spine.message });
}

export function computeVoiceProfileHash(doc: Record<string, unknown>): string {
  const { version: _version, status: _status, approval: _approval, supersededBy: _supersededBy, hash: _hash, ...content } = doc;
  return sha256Canonical(content);
}
