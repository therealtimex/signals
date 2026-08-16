/** Default persona age staleness window (30 days). Config constant, not schema. */
export const PERSONA_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60;

export function parseStoredEvidenceHash(sourceWindow: string | null | undefined): string | null {
  try {
    const parsed = JSON.parse(sourceWindow ?? "{}") as Record<string, unknown>;
    return typeof parsed.evidenceHash === "string" ? parsed.evidenceHash : null;
  } catch {
    return null;
  }
}

export function isPersonaAgeStale(
  generatedAt: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  return now - generatedAt > PERSONA_STALE_AFTER_SECONDS;
}

export function isPersonaEvidenceStale(
  storedHash: string | null,
  currentHash: string,
): boolean {
  return storedHash !== currentHash;
}

export function isPersonaStale(opts: {
  generatedAt: number;
  sourceWindow: string | null | undefined;
  evidenceHash: string;
  now?: number;
}): { stale: boolean; ageStale: boolean; evidenceStale: boolean } {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const storedHash = parseStoredEvidenceHash(opts.sourceWindow);
  const ageStale = isPersonaAgeStale(opts.generatedAt, now);
  const evidenceStale = isPersonaEvidenceStale(storedHash, opts.evidenceHash);
  return {
    stale: ageStale || evidenceStale,
    ageStale,
    evidenceStale,
  };
}
