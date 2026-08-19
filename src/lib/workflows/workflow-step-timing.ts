/** Format seconds elapsed since workflow run start for timeline rows. */
export function formatStepOffsetFromRunStart(
  stepCreatedAt: number,
  runStartedAt: number | null,
): string | null {
  if (runStartedAt == null) return null;
  const offsetSec = Math.max(0, stepCreatedAt - runStartedAt);
  if (offsetSec < 60) return `+${offsetSec}s`;
  const mins = Math.floor(offsetSec / 60);
  const secs = offsetSec % 60;
  if (secs === 0) return `+${mins}m`;
  return `+${mins}m ${secs}s`;
}

/** Spread per-contact step timings evenly across a pipeline handler phase. */
export function distributePhaseTimings(
  count: number,
  phaseStartedAtMs: number,
  phaseEndedAtMs: number,
): Array<{ durationMs: number; completedAtMs: number }> {
  if (count <= 0) return [];

  const phaseDuration = Math.max(phaseEndedAtMs - phaseStartedAtMs, count);
  const perStepDuration = Math.max(1, Math.floor(phaseDuration / count));

  return Array.from({ length: count }, (_, index) => {
    const completedAtMs = Math.min(
      phaseStartedAtMs + perStepDuration * (index + 1),
      phaseEndedAtMs,
    );
    return { durationMs: perStepDuration, completedAtMs };
  });
}
